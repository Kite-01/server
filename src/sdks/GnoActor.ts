import {
  GnoJSONRPCProvider,
  GnoWallet,
  MsgCall,
  MsgEndpoint,
  MsgSend,
  decodeTxMessages,
  type GnoProvider,
} from "@gnolang/gno-js-client";
import {
  ResponseDeliverTx,
  TransactionEndpoint,
  Tx,
  parseProto,
  type Any,
  type GasPrice,
} from "@gnolang/tm2-js-client";
import { getGnoChain } from "../shared/chains";
import { AppError } from "../shared/errors";
import { env } from "../shared/env";
import { GnoNativeToken, gnoKey } from "../shared/gnoAddress";
import { type OnchainActor } from "./interfaces/OnchainActor";

const NotOnGno = (method: string) =>
  new AppError(`${method} isn't available on Gno`);

const Grc20Registry = "gno.land/r/nt/grc20reg/v0";

// what a draft may use while it's simulated; a GnoSwap swap alone uses about 125M
const DraftGas = 1_000_000_000n;

// The gas a simulation used, plus a fifth, at the chain's price, rounded up;
// gno.land's 1 ugnot per 1,000 gas when it reports none
export const gnoTxFee = (gasUsed: bigint, price: GasPrice | null) => {
  const gasWanted = (gasUsed * 6n) / 5n + 10_000n;
  const [amount, gas] = price
    ? [BigInt(price.amount), BigInt(price.gas)]
    : [1n, 1000n];
  return {
    gas_wanted: gasWanted,
    gas_fee: `${(gasWanted * amount + gas - 1n) / gas}${price?.denom ?? GnoNativeToken}`,
  };
};

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

  // tm2-js-client's estimateGas sends the transaction's base64 as its bytes, which
  // nodes can't decode, so it's queried here with the bytes themselves
  private simulate = async (provider: GnoProvider, tx: Tx) => {
    const { response } = await provider.abciQuery({
      path: ".app/simulate",
      data: Tx.encode(tx).finish(),
      height: 0,
      prove: false,
    });
    const result = parseProto(response.Value!, ResponseDeliverTx.decode);
    if (result.response_base?.error) {
      throw new GnoCallError(
        result.response_base.log || "The transaction failed in simulation",
      );
    }
    return result.gas_used;
  };

  // Signs a draft and simulates it, so a call the chain would refuse fails
  // here for free, then sends it with the gas the simulation used
  private broadcast = (caip2Id: Caip2Id, message: Any, rpcUrls?: string[]) => {
    return this.serialize(caip2Id, async () => {
      const wallet = await this.wallet(caip2Id, rpcUrls);
      const provider = await this.provider(caip2Id, rpcUrls);
      const tx = (fee: Tx["fee"]): Tx => ({
        messages: [message],
        fee,
        memo: "",
        signatures: [],
      });

      try {
        const draft = await wallet.signTransaction(
          tx(gnoTxFee(DraftGas, null)),
          decodeTxMessages,
        );
        const used = await this.simulate(provider, draft);
        const fee = gnoTxFee(used, await provider.getGasPrice());
        const signed = await wallet.signTransaction(tx(fee), decodeTxMessages);
        return await wallet.sendTransaction(
          signed,
          TransactionEndpoint.BROADCAST_TX_COMMIT,
        );
      } catch (e) {
        throw new GnoCallError(e instanceof Error ? e.message : String(e));
      }
    });
  };

  call = async (
    caip2Id: Caip2Id,
    pkgPath: string,
    method: string,
    args: string[],
    rpcUrls?: string[],
  ): Promise<GnoCallResult> => {
    const result = await this.broadcast(
      caip2Id,
      {
        type_url: MsgEndpoint.MSG_CALL,
        value: MsgCall.encode({
          caller: this.getAddress(),
          send: "",
          max_deposit: "",
          pkg_path: pkgPath,
          func: method,
          args,
        }).finish(),
      },
      rpcUrls,
    );

    const events = result.deliver_tx.ResponseBase.Events;
    return {
      transactionHash: result.hash,
      events: events ? (JSON.parse(events) as GnoEvent[]) : [],
    };
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

    const result = await this.broadcast(
      caip2Id,
      {
        type_url: MsgEndpoint.MSG_SEND,
        value: MsgSend.encode({
          from_address: this.getAddress(),
          to_address: to,
          amount: `${amount}${GnoNativeToken}`,
        }).finish(),
      },
      rpcUrls,
    );
    return result.hash;
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
