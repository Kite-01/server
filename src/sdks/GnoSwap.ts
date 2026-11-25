import { getGnoChain } from "../shared/chains";
import { getGnoActor } from "../shared/onchainActor";
import {
  UniswapFeeTiers,
  UniswapTwapWindowsSeconds,
} from "../shared/constants";
import { GnoNativeToken } from "../shared/gnoAddress";
import { AppError } from "../shared/errors";
import { meanTick, MaxTick, MinTick, quoteAtTickFor } from "./Uniswap";

const FeeDenominator = 1_000_000n;
const MaxInt64 = 2n ** 63n - 1n;

export type GnoSwapQuote = {
  pool: string;
  amount: bigint;
};

const int64s = (output: string) =>
  [...output.matchAll(/\((-?\d+) int64\)/g)].map((match) => BigInt(match[1]));

const strings = (output: string) =>
  [...output.matchAll(/^\("(\d*)" string\)$/gm)].map((match) => match[1]);

export class GnoSwap {
  private contracts = (caip2Id: Caip2Id) => {
    const chain = getGnoChain(caip2Id);
    if (!chain.contracts.GnoSwap) {
      throw new AppError(`${chain.name} has no GnoSwap deployment`);
    }
    return { ...chain.contracts.GnoSwap, wugnot: chain.contracts.wugnot };
  };

  private eval = (caip2Id: Caip2Id, pkgPath: string, expr: string) =>
    getGnoActor()
      .qeval(caip2Id, pkgPath, expr)
      .catch(() => null);

  // GnoSwap trades wugnot for GNOT; Kite keeps GNOT as ugnot
  token = (caip2Id: Caip2Id, token: string) =>
    token === GnoNativeToken ? this.contracts(caip2Id).wugnot : token;

  /** The pool with the most liquidity, and its time-weighted tick. */
  getTwap = async (caip2Id: Caip2Id, tokenIn: string, tokenOut: string) => {
    const { pool } = this.contracts(caip2Id);
    const [token0, token1] = [tokenIn, tokenOut].sort();
    if (token0 === token1) return null;

    const pools = await Promise.all(
      UniswapFeeTiers.map(async (fee) => {
        const path = `${token0}:${token1}:${fee}`;
        const liquidity = strings(
          (await this.eval(caip2Id, pool, `GetLiquidity("${path}")`)) ?? "",
        )[0];
        if (!liquidity || BigInt(liquidity) === 0n) return null;

        for (const window of UniswapTwapWindowsSeconds) {
          const observed = int64s(
            (await this.eval(
              caip2Id,
              pool,
              `Observe("${path}", []uint32{${window}, 0})`,
            )) ?? "",
          );
          if (observed.length !== 2) continue;

          const tick = meanTick([observed[0], observed[1]], window);
          if (tick >= MinTick && tick <= MaxTick) {
            return { path, fee, liquidity: BigInt(liquidity), tick };
          }
        }
        return null;
      }),
    );

    return pools.reduce<(typeof pools)[number]>(
      (best, p) => (p && (!best || p.liquidity > best.liquidity) ? p : best),
      null,
    );
  };

  private dryRun = async (
    caip2Id: Caip2Id,
    tokenIn: string,
    tokenOut: string,
    amount: bigint,
    type: "EXACT_IN" | "EXACT_OUT",
    path: string,
  ) => {
    const route = path.startsWith(`${tokenIn}:`)
      ? path
      : `${tokenIn}:${tokenOut}:${path.split(":")[2]}`;
    const output = await this.eval(
      caip2Id,
      this.contracts(caip2Id).router,
      `DrySwapRoute("${tokenIn}", "${tokenOut}", "${amount}", "${type}", "${route}", "100", "${type === "EXACT_IN" ? 0n : MaxInt64}")`,
    );
    if (!output || !output.trim().endsWith("(undefined)")) return null;

    const [amountIn, amountOut] = strings(output);
    return amountIn && amountOut
      ? { amountIn: BigInt(amountIn), amountOut: BigInt(amountOut) }
      : null;
  };

  // the time-weighted price keeps a briefly moved pool from setting the price,
  // the dry run adds the price impact the average leaves out
  quoteExactInput = async (input: {
    caip2Id: Caip2Id;
    tokenIn: string;
    tokenOut: string;
    amountIn: bigint;
  }): Promise<GnoSwapQuote | null> => {
    const tokenIn = this.token(input.caip2Id, input.tokenIn);
    const tokenOut = this.token(input.caip2Id, input.tokenOut);
    const twap = await this.getTwap(input.caip2Id, tokenIn, tokenOut);
    if (!twap) return null;

    const dry = await this.dryRun(
      input.caip2Id,
      tokenIn,
      tokenOut,
      input.amountIn,
      "EXACT_IN",
      twap.path,
    );
    if (!dry) return null;

    const atAverage = quoteAtTickFor(
      twap.tick,
      (input.amountIn * (FeeDenominator - BigInt(twap.fee))) / FeeDenominator,
      tokenIn < tokenOut,
    );
    const amount = atAverage < dry.amountOut ? atAverage : dry.amountOut;

    return amount > 0n ? { pool: twap.path, amount } : null;
  };

  quoteExactOutput = async (input: {
    caip2Id: Caip2Id;
    tokenIn: string;
    tokenOut: string;
    amountOut: bigint;
  }): Promise<GnoSwapQuote | null> => {
    const tokenIn = this.token(input.caip2Id, input.tokenIn);
    const tokenOut = this.token(input.caip2Id, input.tokenOut);
    const twap = await this.getTwap(input.caip2Id, tokenIn, tokenOut);
    if (!twap) return null;

    const dry = await this.dryRun(
      input.caip2Id,
      tokenIn,
      tokenOut,
      input.amountOut,
      "EXACT_OUT",
      twap.path,
    );
    if (!dry) return null;

    const lessFee = quoteAtTickFor(
      twap.tick,
      input.amountOut,
      tokenOut < tokenIn,
      true,
    );
    const atAverage =
      (lessFee * FeeDenominator + FeeDenominator - BigInt(twap.fee) - 1n) /
      (FeeDenominator - BigInt(twap.fee));
    const amount = atAverage > dry.amountIn ? atAverage : dry.amountIn;

    return amount > 0n ? { pool: twap.path, amount } : null;
  };
}
