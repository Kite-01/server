import {
  decodeFunctionResult,
  encodeFunctionData,
  getAddress,
  parseAbi,
  type Address,
  type Hex,
} from "viem";
import {
  UniswapFeeTiers,
  UniswapTwapWindowsSeconds,
} from "../shared/constants";
import { type UniswapQuoter } from "./interfaces/UniswapQuoter";
import { getOnchainActor } from "../shared/onchainActor";
import { getChain } from "../shared/chains";
import { common } from "../shared/common";

const Q192 = 1n << 192n;
const FeeDenominator = 1_000_000n;
const MaxUint256 = (1n << 256n) - 1n;
export const MinTick = -887272;
export const MaxTick = 887272;

// TickMath.getSqrtRatioAtTick multipliers: sqrt(1.0001^-(2^i)) as Q128.128.
const TickRatios: Array<[number, bigint]> = [
  [0x2, 0xfff97272373d413259a46990580e213an],
  [0x4, 0xfff2e50f5f656932ef12357cf3c7fdccn],
  [0x8, 0xffe5caca7e10e4e61c3624eaa0941cd0n],
  [0x10, 0xffcb9843d60f6159c9db58835c926644n],
  [0x20, 0xff973b41fa98c081472e6896dfb254c0n],
  [0x40, 0xff2ea16466c96a3843ec78b326b52861n],
  [0x80, 0xfe5dee046a99a2a811c461f1969c3053n],
  [0x100, 0xfcbe86c7900a88aedcffc83b479aa3a4n],
  [0x200, 0xf987a7253ac413176f2b074cf7815e54n],
  [0x400, 0xf3392b0822b70005940c7a398e4b70f3n],
  [0x800, 0xe7159475a2c29b7443b29c7fa6e889d9n],
  [0x1000, 0xd097f3bdfd2022b8845ad8f792aa5825n],
  [0x2000, 0xa9f746462d870fdf8a65dc1f90e061e5n],
  [0x4000, 0x70d869a156d2a1b890bb3df62baf32f7n],
  [0x8000, 0x31be135f97d08fd981231505542fcfa6n],
  [0x10000, 0x9aa508b5b7a84e1c677de54f3e99bc9n],
  [0x20000, 0x5d6af8dedb81196699c329225ee604n],
  [0x40000, 0x2216e584f5fa1ea926041bedfe98n],
  [0x80000, 0x48a170391f7dc42444e8fa2n],
];

/** Uniswap's TickMath.getSqrtRatioAtTick, as a Q64.96 square root price. */
export const sqrtRatioAtTick = (tick: number) => {
  if (!Number.isInteger(tick) || tick < MinTick || tick > MaxTick) {
    throw new RangeError(`Tick ${tick} is out of range`);
  }

  const absTick = Math.abs(tick);
  let ratio =
    absTick & 0x1
      ? 0xfffcb933bd6fad37aa2d162d1a594001n
      : 0x100000000000000000000000000000000n;

  for (const [bit, multiplier] of TickRatios) {
    if (absTick & bit) ratio = (ratio * multiplier) >> 128n;
  }

  if (tick > 0) ratio = MaxUint256 / ratio;

  return (ratio >> 32n) + (ratio % (1n << 32n) === 0n ? 0n : 1n);
};

/**
 * How much of `quoteToken` `amount` of `baseToken` is worth at `tick`, as
 * Uniswap's OracleLibrary.getQuoteAtTick does (rounding down unless `roundUp`).
 */
export const quoteAtTick = (
  tick: number,
  amount: bigint,
  baseToken: string,
  quoteToken: string,
  roundUp = false,
) => {
  const sqrtRatio = sqrtRatioAtTick(tick);
  const ratioX192 = sqrtRatio * sqrtRatio;
  const div = (a: bigint, b: bigint) =>
    roundUp ? common.ceilDiv(a, b) : a / b;

  // The pool price is token1 per token0, token0 being the lower address.
  return BigInt(baseToken) < BigInt(quoteToken)
    ? div(ratioX192 * amount, Q192)
    : div(Q192 * amount, ratioX192);
};

/** The arithmetic mean tick between two tick cumulatives, rounded down. */
export const meanTick = (
  tickCumulatives: readonly [bigint, bigint],
  windowSeconds: number,
) => {
  const delta = tickCumulatives[1] - tickCumulatives[0];
  const window = BigInt(windowSeconds);
  let tick = delta / window;
  if (delta < 0n && delta % window !== 0n) tick -= 1n;
  return Number(tick);
};

/**
 * Prices swaps from Uniswap V3 pool TWAPs rather than the pools' spot price,
 * so a quote can't be skewed by moving a pool within the block it is read in.
 */
export class Uniswap implements UniswapQuoter {
  static readonly RouterAbi = parseAbi([
    "function factory() external view returns (address)",
  ]);

  static readonly FactoryAbi = parseAbi([
    "function getPool(address tokenA, address tokenB, uint24 fee) external view returns (address pool)",
  ]);

  static readonly PoolAbi = parseAbi([
    "function liquidity() external view returns (uint128)",
    "function observe(uint32[] secondsAgos) external view returns (int56[] tickCumulatives, uint160[] secondsPerLiquidityCumulativeX128s)",
  ]);

  private static readonly factories = new Map<Caip2Id, Address>();

  private getToken = (caip2Id: Caip2Id, tokenAddress: string) => {
    if (!common.isZeroAddress(tokenAddress)) return getAddress(tokenAddress);
    return getAddress(getChain(caip2Id).contracts.WETH9);
  };

  private ethCall = async (caip2Id: Caip2Id, to: string, data: Hex) => {
    const onchainActor = getOnchainActor(getChain(caip2Id).type);
    const result = await onchainActor
      .ethCall(caip2Id, to, data)
      .catch(() => null);

    return !result || result === "0x" ? null : (result as Hex);
  };

  // The factory the router swaps through, so quotes read the pools it uses.
  private getFactory = async (caip2Id: Caip2Id) => {
    const cached = Uniswap.factories.get(caip2Id);
    if (cached) return cached;

    const result = await this.ethCall(
      caip2Id,
      getChain(caip2Id).contracts.Uniswap.SwapRouter02,
      encodeFunctionData({ abi: Uniswap.RouterAbi, functionName: "factory" }),
    );

    if (!result) return null;

    const factory = decodeFunctionResult({
      abi: Uniswap.RouterAbi,
      functionName: "factory",
      data: result,
    });

    if (common.isZeroAddress(factory)) return null;

    Uniswap.factories.set(caip2Id, factory);
    return factory;
  };

  private getPoolTwap = async (
    caip2Id: Caip2Id,
    factory: Address,
    tokenA: Address,
    tokenB: Address,
    feeTier: number,
  ) => {
    const poolResult = await this.ethCall(
      caip2Id,
      factory,
      encodeFunctionData({
        abi: Uniswap.FactoryAbi,
        functionName: "getPool",
        args: [tokenA, tokenB, feeTier],
      }),
    );

    if (!poolResult) return null;

    const pool = decodeFunctionResult({
      abi: Uniswap.FactoryAbi,
      functionName: "getPool",
      data: poolResult,
    });

    if (common.isZeroAddress(pool)) return null;

    const liquidityResult = await this.ethCall(
      caip2Id,
      pool,
      encodeFunctionData({ abi: Uniswap.PoolAbi, functionName: "liquidity" }),
    );

    if (!liquidityResult) return null;

    const liquidity = decodeFunctionResult({
      abi: Uniswap.PoolAbi,
      functionName: "liquidity",
      data: liquidityResult,
    });

    if (liquidity === 0n) return null;

    // Pools only keep as much history as their observation cardinality
    // allows, so fall back to shorter windows before giving up on a pool.
    for (const window of UniswapTwapWindowsSeconds) {
      const observed = await this.ethCall(
        caip2Id,
        pool,
        encodeFunctionData({
          abi: Uniswap.PoolAbi,
          functionName: "observe",
          args: [[window, 0]],
        }),
      );

      if (!observed) continue;

      const [cumulatives] = decodeFunctionResult({
        abi: Uniswap.PoolAbi,
        functionName: "observe",
        data: observed,
      });

      if (cumulatives.length === 2) {
        const tick = meanTick([cumulatives[0], cumulatives[1]], window);
        if (tick >= MinTick && tick <= MaxTick) {
          return { feeTier, liquidity, tick, window };
        }
      }
    }

    return null;
  };

  /**
   * The TWAP of the deepest pool between the two tokens, across fee tiers.
   * Liquidity is comparable across a pair's pools, and the deepest is the one
   * a swap is least likely to move away from its TWAP.
   */
  getTwap = async (caip2Id: Caip2Id, tokenIn: string, tokenOut: string) => {
    const factory = await this.getFactory(caip2Id);
    if (!factory) return null;

    const tokenA = this.getToken(caip2Id, tokenIn);
    const tokenB = this.getToken(caip2Id, tokenOut);
    if (tokenA === tokenB) return null;

    const twaps = await Promise.all(
      UniswapFeeTiers.map((feeTier) =>
        this.getPoolTwap(caip2Id, factory, tokenA, tokenB, feeTier),
      ),
    );

    let best: (typeof twaps)[number] = null;
    for (const twap of twaps) {
      if (twap && (!best || twap.liquidity > best.liquidity)) best = twap;
    }

    return best ? { ...best, tokenIn: tokenA, tokenOut: tokenB } : null;
  };

  quoteExactInput = async (
    input: UniswapQuoterExactInputArgs,
  ): Promise<UniswapQuote | null> => {
    const twap = await this.getTwap(
      input.caip2Id,
      input.tokenIn,
      input.tokenOut,
    );

    if (!twap) return null;

    const amountInLessFee =
      (input.amountIn * (FeeDenominator - BigInt(twap.feeTier))) /
      FeeDenominator;

    const amountOut = quoteAtTick(
      twap.tick,
      amountInLessFee,
      twap.tokenIn,
      twap.tokenOut,
    );

    return amountOut > 0n ? { feeTier: twap.feeTier, amount: amountOut } : null;
  };

  quoteExactOutput = async (
    input: UniswapQuoterExactOutputArgs,
  ): Promise<UniswapQuote | null> => {
    const twap = await this.getTwap(
      input.caip2Id,
      input.tokenIn,
      input.tokenOut,
    );

    if (!twap) return null;

    const amountInLessFee = quoteAtTick(
      twap.tick,
      input.amountOut,
      twap.tokenOut,
      twap.tokenIn,
      true,
    );

    const amountIn = common.ceilDiv(
      amountInLessFee * FeeDenominator,
      FeeDenominator - BigInt(twap.feeTier),
    );

    return amountIn > 0n ? { feeTier: twap.feeTier, amount: amountIn } : null;
  };
}
