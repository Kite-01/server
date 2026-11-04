import { getNearChain } from "../shared/chains";
import { getNearActor } from "../shared/onchainActor";
import { NearNativeToken } from "../shared/kiteNearContract";

/** Rhea DCL fee tiers, in hundredths of a basis point. */
export const RheaDclFeeTiers = [100, 400, 2000, 10000] as const;

export type RheaQuote = {
  pool: string;
  amount: bigint;
};

type DclQuoteResult = { amount: string; tag: string | null };

/**
 * Spot quotes from Rhea's DCL pools, which have no time-weighted average to read; the deposit
 * contract still enforces `min_amount_out`.
 */
export class Rhea {
  private dcl = (caip2Id: Caip2Id) => getNearChain(caip2Id).contracts.Rhea?.dcl;

  private token = (caip2Id: Caip2Id, address: string) => {
    return address === NearNativeToken
      ? getNearChain(caip2Id).contracts.wrapNear
      : address;
  };

  poolIds = (tokenA: string, tokenB: string) => {
    const [x, y] = [tokenA, tokenB].sort();
    return RheaDclFeeTiers.map((fee) => `${x}|${y}|${fee}`);
  };

  private quoteEach = async (
    caip2Id: Caip2Id,
    method: "quote" | "quote_by_output",
    tokenIn: string,
    tokenOut: string,
    amountKey: "input_amount" | "output_amount",
    amount: bigint,
  ) => {
    const dcl = this.dcl(caip2Id);
    if (!dcl) return [];

    const input = this.token(caip2Id, tokenIn);
    const output = this.token(caip2Id, tokenOut);
    if (input === output) return [];

    const actor = getNearActor();
    const quotes = await Promise.all(
      this.poolIds(input, output).map(async (pool) => {
        const exists = await actor
          .view<object | null>(caip2Id, dcl, "get_pool", { pool_id: pool })
          .catch(() => null);
        if (!exists) return null;

        const result = await actor
          .view<DclQuoteResult>(caip2Id, dcl, method, {
            pool_ids: [pool],
            input_token: input,
            output_token: output,
            [amountKey]: amount.toString(),
            tag: null,
          })
          .catch(() => null);

        const value = result ? BigInt(result.amount) : 0n;
        return value > 0n ? { pool, amount: value } : null;
      }),
    );

    return quotes.filter((q): q is RheaQuote => q !== null);
  };

  quoteExactInput = async (input: {
    caip2Id: Caip2Id;
    tokenIn: string;
    tokenOut: string;
    amountIn: bigint;
  }): Promise<RheaQuote | null> => {
    const quotes = await this.quoteEach(
      input.caip2Id,
      "quote",
      input.tokenIn,
      input.tokenOut,
      "input_amount",
      input.amountIn,
    );

    return quotes.reduce<RheaQuote | null>(
      (best, q) => (!best || q.amount > best.amount ? q : best),
      null,
    );
  };

  quoteExactOutput = async (input: {
    caip2Id: Caip2Id;
    tokenIn: string;
    tokenOut: string;
    amountOut: bigint;
  }): Promise<RheaQuote | null> => {
    const quotes = await this.quoteEach(
      input.caip2Id,
      "quote_by_output",
      input.tokenIn,
      input.tokenOut,
      "output_amount",
      input.amountOut,
    );

    return quotes.reduce<RheaQuote | null>(
      (best, q) => (!best || q.amount < best.amount ? q : best),
      null,
    );
  };
}
