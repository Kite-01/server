import {
  Account,
  Asset,
  StrKey,
  BASE_FEE,
  Contract,
  rpc,
  scValToNative,
  TransactionBuilder,
  xdr,
  Address,
  type Keypair,
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

  isSac = async (caip2Id: Caip2Id, token: string, rpcUrls?: string[]) => {
    const name = await this.view<string>(caip2Id, token, "name", [], rpcUrls);
    const [code, issuer] = name.split(":");
    const asset =
      name === "native"
        ? Asset.native()
        : issuer
          ? new Asset(code, issuer)
          : null;
    return asset?.contractId(this.passphrase(caip2Id)) === token;
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
