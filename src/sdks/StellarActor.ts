import {
  Account,
  Asset,
  Operation,
  StrKey,
  BASE_FEE,
  Contract,
  rpc,
  scValToNative,
  TransactionBuilder,
  xdr,
  Address,
  Keypair,
} from "@stellar/stellar-sdk";
import { getStellarChain } from "../shared/chains";
import { AppError } from "../shared/errors";
import { env } from "../shared/env";
import { type OnchainActor } from "./interfaces/OnchainActor";
import { stellarKeypair } from "../shared/stellarAddress";

const NotOnStellar = (method: string) =>
  new AppError(`${method} isn't available on Stellar`);

export class StellarSimulationError extends AppError {
  constructor(
    message: string,
    readonly contract: string | null,
    readonly code: number | null,
  ) {
    super(message);
  }
}

// the contract that raised the final error, not one a `try_` call recovered from
export const simulationError = (
  result: rpc.Api.SimulateTransactionErrorResponse,
) => {
  const code = /Error\(Contract, #(\d+)\)/.exec(result.error)?.[1];
  const raised = (result.events ?? [])
    .map((event) => event.event())
    .find((event) => {
      const [name, error] = event.body().v0().topics();
      return (
        event.contractId() &&
        name?.switch().name === "scvSymbol" &&
        name.sym().toString() === "error" &&
        error?.switch().name === "scvError" &&
        error.error().switch().name === "sceContract" &&
        String(error.error().contractCode()) === code
      );
    });
  const contractId = raised?.contractId();

  return new StellarSimulationError(
    result.error,
    contractId ? StrKey.encodeContract(contractId as unknown as Buffer) : null,
    code ? Number(code) : null,
  );
};

export type StellarCallResult = {
  transactionHash: string;
  status: "success" | "failure";
  failure?: string;
  events: xdr.ContractEvent[];
};

const TxTimeoutSeconds = 60;
const PollAttempts = 30;

export class StellarActor implements OnchainActor {
  private keypairs = new Map<number, Keypair>();
  private assets = new Map<string, Asset | null>();
  private queue = new Map<string, Promise<unknown>>();

  keypair = (index = 0) => {
    let keypair = this.keypairs.get(index);
    if (!keypair) {
      keypair = stellarKeypair(env.KITE_OPERATOR_MNEMONIC, index);
      this.keypairs.set(index, keypair);
    }
    return keypair;
  };

  getAddress = (): string => this.keypair().publicKey();

  passphrase = (caip2Id: Caip2Id) => getStellarChain(caip2Id).networkPassphrase;

  rpc = (caip2Id: Caip2Id, rpcUrls: string[] = []) => {
    const url = rpcUrls[0] ?? getStellarChain(caip2Id).publicRpcUrls[0];
    return new rpc.Server(url, { allowHttp: url.startsWith("http://") });
  };

  serialize = <T>(caip2Id: Caip2Id, run: () => Promise<T>) => {
    const previous = this.queue.get(caip2Id) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(run);
    this.queue.set(caip2Id, next);
    return next;
  };

  private build = (
    caip2Id: Caip2Id,
    account: Account,
    contract: string,
    method: string,
    args: xdr.ScVal[],
  ) => {
    return new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: this.passphrase(caip2Id),
    })
      .addOperation(new Contract(contract).call(method, ...args))
      .setTimeout(TxTimeoutSeconds)
      .build();
  };

  simulate = async (
    caip2Id: Caip2Id,
    contract: string,
    method: string,
    args: xdr.ScVal[] = [],
    rpcUrls?: string[],
  ): Promise<xdr.ScVal> => {
    const tx = this.build(
      caip2Id,
      new Account(this.getAddress(), "0"),
      contract,
      method,
      args,
    );
    const result = await this.rpc(caip2Id, rpcUrls).simulateTransaction(tx);
    if (rpc.Api.isSimulationError(result)) {
      throw simulationError(result);
    }

    return result.result?.retval ?? xdr.ScVal.scvVoid();
  };

  view = async <T>(
    caip2Id: Caip2Id,
    contract: string,
    method: string,
    args: xdr.ScVal[] = [],
    rpcUrls?: string[],
  ): Promise<T> => {
    return scValToNative(
      await this.simulate(caip2Id, contract, method, args, rpcUrls),
    ) as T;
  };

  invoke = (
    caip2Id: Caip2Id,
    contract: string,
    method: string,
    args: xdr.ScVal[],
    rpcUrls?: string[],
  ): Promise<StellarCallResult> => {
    return this.serialize(caip2Id, async () => {
      const server = this.rpc(caip2Id, rpcUrls);
      const account = await server.getAccount(this.getAddress());
      const built = this.build(caip2Id, account, contract, method, args);
      const simulation = await server.simulateTransaction(built);
      if (rpc.Api.isSimulationError(simulation)) {
        throw simulationError(simulation);
      }

      const tx = rpc.assembleTransaction(built, simulation).build();
      tx.sign(this.keypair());

      const sent = await server.sendTransaction(tx);
      if (sent.status === "ERROR" || sent.status === "TRY_AGAIN_LATER") {
        throw new AppError(
          `Stellar refused the transaction (${sent.status}): ${sent.errorResult?.result().switch().name ?? "no detail"}`,
        );
      }

      const result = await server.pollTransaction(sent.hash, {
        attempts: PollAttempts,
      });
      return this.toResult(sent.hash, result);
    });
  };

  getOutcome = async (
    caip2Id: Caip2Id,
    transactionHash: string,
    rpcUrls?: string[],
  ) => {
    const result = await this.rpc(caip2Id, rpcUrls).getTransaction(
      transactionHash,
    );
    return this.toResult(transactionHash, result);
  };

  private toResult = (
    transactionHash: string,
    result: rpc.Api.GetTransactionResponse,
  ): StellarCallResult => {
    if (result.status === rpc.Api.GetTransactionStatus.NOT_FOUND) {
      throw new AppError(`Transaction ${transactionHash} isn't confirmed yet`);
    }

    if (result.status === rpc.Api.GetTransactionStatus.FAILED) {
      return {
        transactionHash,
        status: "failure",
        failure: result.resultXdr.result().switch().name,
        events: [],
      };
    }

    return {
      transactionHash,
      status: "success",
      events: result.events?.contractEventsXdr.flat() ?? [],
    };
  };

  getBalance = async (
    caip2Id: Caip2Id,
    tokenAddress: string,
    address: string,
  ): Promise<bigint> => {
    return BigInt(
      await this.view<bigint>(caip2Id, tokenAddress, "balance", [
        Address.fromString(address).toScVal(),
      ]),
    );
  };

  // the asset a Stellar Asset Contract wraps, or null for any other token; a contract's
  // name never changes, so the answer is kept
  assetOf = async (caip2Id: Caip2Id, token: string, rpcUrls?: string[]) => {
    const key = `${caip2Id}:${token}`;
    if (this.assets.has(key)) return this.assets.get(key)!;

    const name = await this.view<string>(caip2Id, token, "name", [], rpcUrls);
    const [code, issuer] = name.split(":");
    const candidate =
      name === "native"
        ? Asset.native()
        : issuer
          ? new Asset(code, issuer)
          : null;
    const asset =
      candidate?.contractId(this.passphrase(caip2Id)) === token
        ? candidate
        : null;
    this.assets.set(key, asset);
    return asset;
  };

  isSac = async (caip2Id: Caip2Id, token: string, rpcUrls?: string[]) =>
    !!(await this.assetOf(caip2Id, token, rpcUrls));

  // Whether `address` can be paid `token`, in one ledger read. A Stellar Asset Contract
  // pays a G… or M… account only once it's funded with XLM and, for an issued asset,
  // trusts it; other tokens and C… addresses keep balances in contract storage.
  receivable = async (
    caip2Id: Caip2Id,
    token: string,
    address: string,
    rpcUrls?: string[],
  ): Promise<"ok" | "unfunded" | "untrusted"> => {
    if (StrKey.isValidContract(address)) return "ok";

    const asset = await this.assetOf(caip2Id, token, rpcUrls);
    if (!asset) return "ok";

    const account = this.accountOf(address);
    const accountId = Keypair.fromPublicKey(account).xdrAccountId();
    const needsTrust = !asset.isNative() && asset.getIssuer() !== account;
    const keys = [
      xdr.LedgerKey.account(new xdr.LedgerKeyAccount({ accountId })),
      ...(needsTrust
        ? [
            xdr.LedgerKey.trustline(
              new xdr.LedgerKeyTrustLine({
                accountId,
                asset: asset.toTrustLineXDRObject(),
              }),
            ),
          ]
        : []),
    ];
    const { entries } = await this.rpc(caip2Id, rpcUrls).getLedgerEntries(
      ...keys,
    );
    const found = (type: xdr.LedgerEntryType) =>
      entries.some((entry) => entry.key.switch() === type);

    if (!found(xdr.LedgerEntryType.account())) return "unfunded";
    if (needsTrust && !found(xdr.LedgerEntryType.trustline()))
      return "untrusted";
    return "ok";
  };

  private accountOf = (address: string) =>
    StrKey.isValidMed25519PublicKey(address)
      ? StrKey.encodeEd25519PublicKey(
          StrKey.decodeMed25519PublicKey(address).subarray(0, 32),
        )
      : address;

  // the operator can only hold an issued asset through a trustline
  // a G… account needs a trustline to hold an issued asset
  canHold = async (
    caip2Id: Caip2Id,
    token: string,
    address: string,
    rpcUrls?: string[],
  ) => {
    if (StrKey.isValidContract(address)) return true;

    const account = this.accountOf(address);
    const asset = await this.assetOf(caip2Id, token, rpcUrls);
    if (!asset || asset.isNative() || asset.getIssuer() === account) {
      return true;
    }

    const key = xdr.LedgerKey.trustline(
      new xdr.LedgerKeyTrustLine({
        accountId: Keypair.fromPublicKey(account).xdrAccountId(),
        asset: asset.toTrustLineXDRObject(),
      }),
    );
    const { entries } = await this.rpc(caip2Id, rpcUrls).getLedgerEntries(key);
    return entries.length > 0;
  };

  trust = async (caip2Id: Caip2Id, token: string, rpcUrls?: string[]) => {
    if (await this.canHold(caip2Id, token, this.getAddress(), rpcUrls)) return;

    const server = this.rpc(caip2Id, rpcUrls);
    const asset = (await this.assetOf(caip2Id, token, rpcUrls))!;

    await this.serialize(caip2Id, async () => {
      const account = await server.getAccount(this.getAddress());
      const tx = new TransactionBuilder(account, {
        fee: BASE_FEE,
        networkPassphrase: this.passphrase(caip2Id),
      })
        .addOperation(Operation.changeTrust({ asset }))
        .setTimeout(TxTimeoutSeconds)
        .build();
      tx.sign(this.keypair());

      const sent = await server.sendTransaction(tx);
      const result =
        sent.status === "PENDING"
          ? await server.pollTransaction(sent.hash, { attempts: PollAttempts })
          : null;
      if (result?.status !== rpc.Api.GetTransactionStatus.SUCCESS) {
        throw new AppError(
          `The operator ${this.getAddress()} couldn't add a trustline for ${asset.getCode()}; check it holds enough XLM`,
        );
      }
    });
  };

  getBlockNumber = async (caip2Id: Caip2Id): Promise<bigint> => {
    const ledger = await this.rpc(caip2Id).getLatestLedger();
    return BigInt(ledger.sequence);
  };

  getBlockTimestamp = async (
    caip2Id: Caip2Id,
    blockNumber: bigint,
  ): Promise<bigint> => {
    const { ledgers } = await this.rpc(caip2Id).getLedgers({
      startLedger: Number(blockNumber),
      pagination: { limit: 1 },
    });
    if (!ledgers[0]) throw new AppError(`Ledger ${blockNumber} is unknown`);
    return BigInt(ledgers[0].ledgerCloseTime);
  };

  getConfirmations = async (
    caip2Id: Caip2Id,
    transactionHash: string,
  ): Promise<bigint> => {
    try {
      const result = await this.getOutcome(caip2Id, transactionHash);
      return result.status === "success" ? 1n : 0n;
    } catch {
      return 0n;
    }
  };

  getTransactionStatus = async (
    caip2Id: Caip2Id,
    callId: string,
  ): Promise<OnchainActorCallStatus> => {
    try {
      const result = await this.getOutcome(caip2Id, callId);
      return { status: result.status, transactionHash: result.transactionHash };
    } catch {
      return { status: "pending" };
    }
  };

  waitForTransaction = async (
    caip2Id: Caip2Id,
    callId: string,
  ): Promise<OnchainActorCallStatus> => {
    return this.getTransactionStatus(caip2Id, callId);
  };

  getSponsorshipError = async (): Promise<string | null> => {
    return "Gas sponsors aren't available on Stellar; the operator pays fees";
  };

  publicClient = async (): Promise<import("viem").PublicClient> => {
    throw NotOnStellar("publicClient");
  };

  submitTransaction = async (): Promise<string> => {
    throw NotOnStellar("submitTransaction");
  };

  sendTransaction = async (): Promise<string> => {
    throw NotOnStellar("sendTransaction");
  };

  waitForReceipt = async (): Promise<OnchainActorReceipt> => {
    throw NotOnStellar("waitForReceipt");
  };

  ethCall = async (): Promise<string> => {
    throw NotOnStellar("ethCall");
  };

  getContractCode = async (): Promise<string> => {
    throw NotOnStellar("getContractCode");
  };

  getGasPrice = async (): Promise<bigint> => {
    throw NotOnStellar("getGasPrice");
  };
}
