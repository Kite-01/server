import {
  Account,
  FailoverRpcProvider,
  JsonRpcProvider,
  type KeyPairString,
  actions,
  type FinalExecutionOutcome,
} from "near-api-js";
import { parseSeedPhrase } from "near-api-js/seed-phrase";
import { getNearChain } from "../shared/chains";
import { AppError } from "../shared/errors";
import { env } from "../shared/env";
import { type OnchainActor } from "./interfaces/OnchainActor";
import { NearNativeToken } from "../shared/kiteNearContract";

const NotOnNear = (method: string) =>
  new AppError(`${method} isn't available on NEAR`);

export type NearFunctionCall = {
  contractId: string;
  method: string;
  args: Record<string, unknown>;
  deposit?: bigint;
  gas?: bigint;
};

export type NearCallResult = {
  transactionHash: string;
  status: "success" | "failure";
  failure?: string;
  outcome: FinalExecutionOutcome;
};

const MaxGas = 300_000_000_000_000n;

/**
 * The operator on NEAR: an implicit account whose ed25519 key comes from
 * `KITE_OPERATOR_MNEMONIC` on NEAR's path, m/44'/397'/0'. It is a different key from the
 * operator's EVM key, derived from the same seed.
 *
 * The EVM-only parts of `OnchainActor` (viem clients, gas sponsors) throw here.
 */
export class NearActor implements OnchainActor {
  private keyPair?: ReturnType<typeof parseSeedPhrase>;
  private queue = new Map<string, Promise<unknown>>();

  private getKeyPair = () => {
    this.keyPair ??= parseSeedPhrase(env.KITE_OPERATOR_MNEMONIC);
    return this.keyPair;
  };

  getAddress = (): string => {
    return Buffer.from(this.getKeyPair().getPublicKey().data).toString("hex");
  };

  getPublicKey = () => this.getKeyPair().getPublicKey().toString();

  /** The operator's secret key, for the x402 relayer, which signs its own transactions. */
  getSecretKey = () => this.getKeyPair().toString() as KeyPairString;

  provider = (caip2Id: Caip2Id, rpcUrls: string[] = []) => {
    const chain = getNearChain(caip2Id);
    const urls = [...new Set([...rpcUrls, ...chain.publicRpcUrls])];
    return new FailoverRpcProvider(
      urls.map((url) => new JsonRpcProvider({ url })),
    );
  };

  private account = (caip2Id: Caip2Id, rpcUrls?: string[]) => {
    return new Account(
      this.getAddress(),
      this.provider(caip2Id, rpcUrls),
      this.getKeyPair().toString() as KeyPairString,
    );
  };

  /** Sends one at a time per chain, so concurrent jobs don't race for the access key's nonce. */
  serialize = <T>(caip2Id: Caip2Id, run: () => Promise<T>) => {
    const previous = this.queue.get(caip2Id) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(run);
    this.queue.set(caip2Id, next);
    return next;
  };

  view = async <T>(
    caip2Id: Caip2Id,
    contractId: string,
    method: string,
    args: Record<string, unknown> = {},
    rpcUrls?: string[],
  ): Promise<T> => {
    return (await this.provider(caip2Id, rpcUrls).callFunction({
      contractId,
      method,
      args,
    })) as T;
  };

  /** An access key's nonce, or null when the account has no such key. */
  viewAccessKey = async (
    caip2Id: Caip2Id,
    accountId: string,
    publicKey: string,
    rpcUrls?: string[],
  ) => {
    try {
      const key = await this.provider(caip2Id, rpcUrls).viewAccessKey({
        accountId,
        publicKey,
        finalityQuery: { finality: "final" },
      });
      return { nonce: BigInt(key.nonce) };
    } catch (e) {
      if (/does not exist|UNKNOWN_ACCESS_KEY|UNKNOWN_ACCOUNT/i.test(String(e)))
        return null;
      throw e;
    }
  };

  accountExists = async (
    caip2Id: Caip2Id,
    accountId: string,
    rpcUrls?: string[],
  ) => {
    try {
      await this.provider(caip2Id, rpcUrls).viewAccount({
        accountId,
        blockQuery: { finality: "final" },
      });
      return true;
    } catch (e) {
      if (/does not exist|UNKNOWN_ACCOUNT/i.test(String(e))) return false;
      throw e;
    }
  };

  functionCall = (
    caip2Id: Caip2Id,
    calls: NearFunctionCall | NearFunctionCall[],
    rpcUrls?: string[],
  ): Promise<NearCallResult> => {
    const list = Array.isArray(calls) ? calls : [calls];
    const receivers = new Set(list.map((c) => c.contractId));
    if (receivers.size !== 1) {
      throw new AppError("A NEAR transaction has one receiver");
    }

    return this.serialize(caip2Id, async () => {
      const outcome = (await this.account(
        caip2Id,
        rpcUrls,
      ).signAndSendTransaction({
        receiverId: list[0].contractId,
        actions: list.map((c) =>
          actions.functionCall(
            c.method,
            c.args,
            c.gas ?? MaxGas / BigInt(list.length),
            c.deposit ?? 0n,
          ),
        ),
        waitUntil: "FINAL",
        throwOnFailure: false,
      })) as FinalExecutionOutcome;

      return this.toResult(outcome);
    });
  };

  transferNear = (
    caip2Id: Caip2Id,
    receiverId: string,
    amount: bigint,
    rpcUrls?: string[],
  ) => {
    return this.serialize(caip2Id, async () => {
      const outcome = (await this.account(
        caip2Id,
        rpcUrls,
      ).signAndSendTransaction({
        receiverId,
        actions: [actions.transfer(amount)],
        waitUntil: "FINAL",
        throwOnFailure: false,
      })) as FinalExecutionOutcome;

      return this.toResult(outcome);
    });
  };

  getOutcome = async (
    caip2Id: Caip2Id,
    transactionHash: string,
    rpcUrls?: string[],
  ) => {
    const outcome = (await this.provider(
      caip2Id,
      rpcUrls,
    ).viewTransactionStatusWithReceipts({
      txHash: transactionHash,
      accountId: this.getAddress(),
      waitUntil: "FINAL",
    })) as FinalExecutionOutcome;

    return this.toResult(outcome);
  };

  private toResult = (outcome: FinalExecutionOutcome): NearCallResult => {
    const status = outcome.status as Record<string, unknown>;
    const failure =
      "Failure" in status
        ? JSON.stringify(status.Failure)
        : outcome.receipts_outcome
            .map((r) => r.outcome.status as Record<string, unknown>)
            .filter((s) => "Failure" in s)
            .map((s) => JSON.stringify(s.Failure))[0];

    return {
      transactionHash: outcome.transaction_outcome.id,
      status: "Failure" in status ? "failure" : "success",
      failure,
      outcome,
    };
  };

  getBalance = async (
    caip2Id: Caip2Id,
    tokenAddress: string,
    address: string,
  ): Promise<bigint> => {
    if (tokenAddress === NearNativeToken) {
      try {
        const account = await this.provider(caip2Id).viewAccount({
          accountId: address,
          blockQuery: { finality: "final" },
        });
        return BigInt(account.amount);
      } catch (e) {
        if (/does not exist|UNKNOWN_ACCOUNT/i.test(String(e))) return 0n;
        throw e;
      }
    }

    const balance = await this.view<string>(
      caip2Id,
      tokenAddress,
      "ft_balance_of",
      {
        account_id: address,
      },
    );
    return BigInt(balance ?? "0");
  };

  getBlockNumber = async (caip2Id: Caip2Id): Promise<bigint> => {
    const block = await this.provider(caip2Id).viewBlock({ finality: "final" });
    return BigInt(block.header.height);
  };

  getBlockTimestamp = async (
    caip2Id: Caip2Id,
    blockNumber: bigint,
  ): Promise<bigint> => {
    const block = await this.provider(caip2Id).viewBlock({
      blockId: Number(blockNumber),
    });
    return BigInt(block.header.timestamp) / 1_000_000_000n;
  };

  /** NEAR blocks are final after one confirmation; a transaction found as final has it. */
  getConfirmations = async (
    caip2Id: Caip2Id,
    transactionHash: string,
  ): Promise<bigint> => {
    try {
      await this.getOutcome(caip2Id, transactionHash);
      return 1n;
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
      return result.status === "success"
        ? { status: "success", transactionHash: result.transactionHash }
        : { status: "failure", transactionHash: result.transactionHash };
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

  publicClient = async (): Promise<import("viem").PublicClient> => {
    throw NotOnNear("publicClient");
  };

  submitTransaction = async (): Promise<string> => {
    throw NotOnNear("submitTransaction");
  };

  sendTransaction = async (): Promise<string> => {
    throw NotOnNear("sendTransaction");
  };

  getSponsorshipError = async (): Promise<string | null> => {
    return "Gas sponsors aren't available on NEAR; the operator pays gas";
  };

  waitForReceipt = async (): Promise<OnchainActorReceipt> => {
    throw NotOnNear("waitForReceipt");
  };

  ethCall = async (): Promise<string> => {
    throw NotOnNear("ethCall");
  };

  getContractCode = async (): Promise<string> => {
    throw NotOnNear("getContractCode");
  };

  getGasPrice = async (): Promise<bigint> => {
    throw NotOnNear("getGasPrice");
  };
}
