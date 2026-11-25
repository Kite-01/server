import {
  GnoJSONRPCProvider,
  GnoWallet,
  type GnoProvider,
} from "@gnolang/gno-js-client";
import { TransactionEndpoint } from "@gnolang/tm2-js-client";
import { getGnoChain } from "../shared/chains";
import { AppError } from "../shared/errors";
import { env } from "../shared/env";
import { GnoNativeToken, gnoKey } from "../shared/gnoAddress";
import { type OnchainActor } from "./interfaces/OnchainActor";

const NotOnGno = (method: string) =>
  new AppError(`${method} isn't available on Gno`);

const Grc20Registry = "gno.land/r/nt/grc20reg/v0";

// gno.land charges 1 ugnot per 1,000 gas
const TxFee = { gas_wanted: 50_000_000n, gas_fee: "50000ugnot" };

export class GnoCallError extends AppError {}

export type GnoCallResult = {
  transactionHash: string;
  events: GnoEvent[];
};

export type GnoEvent = {
  type: string;
  pkg_path: string;
  attrs: Array<{ key: string; value: string }>;
};

// one value of `vm/qeval`'s output, like ("4556245" string) or (true bool)
export const parseQeval = (output: string) => {
  const match = /^\((.*) ([^ ()]+)\)$/m.exec(output.trim());
  if (!match) throw new AppError(`Unexpected Gno result: ${output}`);
  const [, value] = match;
  return value.startsWith('"') ? (JSON.parse(value) as string) : value;
};

export class GnoActor implements OnchainActor {
  private key?: ReturnType<typeof gnoKey>;
  private providers = new Map<string, Promise<GnoProvider>>();
  private queue = new Map<string, Promise<unknown>>();

  getAddress = (): string => {
    this.key ??= gnoKey(env.KITE_OPERATOR_MNEMONIC, 0);
    return this.key.address;
  };

  provider = (caip2Id: Caip2Id, rpcUrls: string[] = []) => {
    const url = rpcUrls[0] ?? getGnoChain(caip2Id).publicRpcUrls[0];
    let provider = this.providers.get(url);
    if (!provider) {
      provider = GnoJSONRPCProvider.create(url);
      provider.catch(() => this.providers.delete(url));
      this.providers.set(url, provider);
    }
    return provider;
  };

  qeval = async (
    caip2Id: Caip2Id,
    pkgPath: string,
    expression: string,
    rpcUrls?: string[],
  ) => {
    const provider = await this.provider(caip2Id, rpcUrls);
    return provider.evaluateExpression(pkgPath, expression);
  };

  evaluate = async (
    caip2Id: Caip2Id,
    pkgPath: string,
    expression: string,
    rpcUrls?: string[],
  ) => parseQeval(await this.qeval(caip2Id, pkgPath, expression, rpcUrls));

  private serialize = <T>(caip2Id: Caip2Id, run: () => Promise<T>) => {
    const previous = this.queue.get(caip2Id) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(run);
    this.queue.set(caip2Id, next);
    return next;
  };

  private wallet = async (caip2Id: Caip2Id, rpcUrls?: string[]) => {
    const wallet = await GnoWallet.fromMnemonic(env.KITE_OPERATOR_MNEMONIC, {
      addressPrefix: "g",
      accountIndex: 0,
    });
    wallet.connect(await this.provider(caip2Id, rpcUrls));
    return wallet;
  };

  call = (
    caip2Id: Caip2Id,
    pkgPath: string,
    method: string,
    args: string[],
    rpcUrls?: string[],
  ): Promise<GnoCallResult> => {
    return this.serialize(caip2Id, async () => {
      const wallet = await this.wallet(caip2Id, rpcUrls);
      const result = await wallet
        .callMethod(
          pkgPath,
          method,
          args,
          TransactionEndpoint.BROADCAST_TX_COMMIT,
          undefined,
          undefined,
          TxFee,
        )
        .catch((e: unknown) => {
          throw new GnoCallError(e instanceof Error ? e.message : String(e));
        });

      const events = result.deliver_tx.ResponseBase.Events;
      return {
        transactionHash: result.hash,
        events: events ? (JSON.parse(events) as GnoEvent[]) : [],
      };
    });
  };

  // a GRC20 is moved through its realm's Transfer, as grc20 tokens expose it
  send = async (
    caip2Id: Caip2Id,
    token: string,
    to: string,
    amount: bigint,
    rpcUrls?: string[],
  ): Promise<string> => {
    if (token !== GnoNativeToken) {
      const result = await this.call(
        caip2Id,
        token.slice(0, token.lastIndexOf(".")),
        "Transfer",
        [to, amount.toString()],
        rpcUrls,
      );
      return result.transactionHash;
    }

    return this.serialize(caip2Id, async () => {
      const wallet = await this.wallet(caip2Id, rpcUrls);
      const result = await wallet
        .transferFunds(
          to,
          new Map([[GnoNativeToken, Number(amount)]]),
          TransactionEndpoint.BROADCAST_TX_COMMIT,
          TxFee,
        )
        .catch((e: unknown) => {
          throw new GnoCallError(e instanceof Error ? e.message : String(e));
        });
      return result.hash;
    });
  };

  getBalance = async (
    caip2Id: Caip2Id,
    tokenAddress: string,
    address: string,
    rpcUrls?: string[],
  ): Promise<bigint> => {
    if (tokenAddress === GnoNativeToken) {
      const provider = await this.provider(caip2Id, rpcUrls);
      return BigInt(await provider.getBalance(address, GnoNativeToken));
    }

    return BigInt(
      await this.evaluate(
        caip2Id,
        Grc20Registry,
        `MustGet(${JSON.stringify(tokenAddress)}).BalanceOf(${JSON.stringify(address)})`,
        rpcUrls,
      ),
    );
  };

  getTokenMetadata = async (
    caip2Id: Caip2Id,
    tokenAddress: string,
    rpcUrls?: string[],
  ) => {
    const read = (method: string) =>
      this.evaluate(
        caip2Id,
        Grc20Registry,
        `MustGet(${JSON.stringify(tokenAddress)}).${method}()`,
        rpcUrls,
      );
    const [name, symbol, decimals] = await Promise.all([
      read("GetName"),
      read("GetSymbol"),
      read("GetDecimals"),
    ]);
    return { name, symbol, decimals: Number(decimals) };
  };

  getBlockNumber = async (caip2Id: Caip2Id): Promise<bigint> => {
    const provider = await this.provider(caip2Id);
    return BigInt(await provider.getBlockNumber());
  };

  getBlockTimestamp = async (
    caip2Id: Caip2Id,
    blockNumber: bigint,
  ): Promise<bigint> => {
    const provider = await this.provider(caip2Id);
    const block = await provider.getBlock(Number(blockNumber));
    return BigInt(Math.floor(Date.parse(block.block_meta.header.time) / 1000));
  };

  getConfirmations = async (
    caip2Id: Caip2Id,
    transactionHash: string,
  ): Promise<bigint> => {
    const status = await this.getTransactionStatus(caip2Id, transactionHash);
    return status.status === "success" ? 1n : 0n;
  };

  getTransactionStatus = async (
    caip2Id: Caip2Id,
    callId: string,
  ): Promise<OnchainActorCallStatus> => {
    try {
      const provider = await this.provider(caip2Id);
      const tx = await provider.getTransaction(callId);
      return {
        status: tx.tx_result.ResponseBase.Error ? "failure" : "success",
        transactionHash: callId,
      };
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
    return "Gas sponsors aren't available on Gno; the operator pays fees";
  };

  publicClient = async (): Promise<import("viem").PublicClient> => {
    throw NotOnGno("publicClient");
  };

  submitTransaction = async (): Promise<string> => {
    throw NotOnGno("submitTransaction");
  };

  sendTransaction = async (): Promise<string> => {
    throw NotOnGno("sendTransaction");
  };

  waitForReceipt = async (): Promise<OnchainActorReceipt> => {
    throw NotOnGno("waitForReceipt");
  };

  ethCall = async (): Promise<string> => {
    throw NotOnGno("ethCall");
  };

  getContractCode = async (): Promise<string> => {
    throw NotOnGno("getContractCode");
  };

  getGasPrice = async (): Promise<bigint> => {
    throw NotOnGno("getGasPrice");
  };
}
