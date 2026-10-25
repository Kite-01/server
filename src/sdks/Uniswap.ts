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

const Q112 = 1n << 112n;
const Q192 = 1n << 192n;
const FeeDenominator = 1_000_000n;
const MaxUint256 = (1n << 256n) - 1n;
const Uint256 = 1n << 256n;
const Uint32 = 1n << 32n;

const V2FeeNumerator = 997n;
const V2FeeDenominator = 1000n;

// UniswapV2Library.getAmountOut
export const v2AmountOut = (
  amountIn: bigint,
  reserveIn: bigint,
  reserveOut: bigint,
) => {
  const amountInWithFee = amountIn * V2FeeNumerator;
  return (
    (amountInWithFee * reserveOut) /
    (reserveIn * V2FeeDenominator + amountInWithFee)
  );
};

// UniswapV2Library.getAmountIn
export const v2AmountIn = (
  amountOut: bigint,
  reserveIn: bigint,
  reserveOut: bigint,
) => {
  if (amountOut >= reserveOut) {
    return null;
  }

  return (
    (reserveIn * amountOut * V2FeeDenominator) /
      ((reserveOut - amountOut) * V2FeeNumerator) +
    1n
  );
};

// a pair's price accumulator as of `timestamp`, adding the time since its last trade
export const v2CumulativeAt = (
  observation: {
    cumulative: bigint;
    reserveIn: bigint;
    reserveOut: bigint;
    blockTimestampLast: bigint;
  },
  timestamp: bigint,
) => {
  const elapsed =
    ((timestamp % Uint32) - observation.blockTimestampLast + Uint32) % Uint32;

  return (
    (observation.cumulative +
      ((observation.reserveOut * Q112) / observation.reserveIn) * elapsed) %
    Uint256
  );
};

export const v2MeanPriceX112 = (
  cumulativePast: bigint,
  cumulativeNow: bigint,
  elapsedSeconds: bigint,
) => {
  return (
    ((cumulativeNow - cumulativePast + Uint256) % Uint256) / elapsedSeconds
  );
};

export const MinTick = -887272;
export const MaxTick = 887272;

export const sqrtRatioAtTick = (tick: number) => {
  if (!Number.isInteger(tick) || tick < MinTick || tick > MaxTick) {
    throw new RangeError(`Tick ${tick} is out of range`);
  }

  const absTick = Math.abs(tick);
  let ratio =
    absTick & 0x1
      ? 0xfffcb933bd6fad37aa2d162d1a594001n
      : 0x100000000000000000000000000000000n;

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

  for (const [bit, multiplier] of TickRatios) {
    if (absTick & bit) {
      ratio = (ratio * multiplier) >> 128n;
    }
  }

  if (tick > 0) {
    ratio = MaxUint256 / ratio;
  }

  return (ratio >> 32n) + (ratio % (1n << 32n) === 0n ? 0n : 1n);
};

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

  return BigInt(baseToken) < BigInt(quoteToken)
    ? div(ratioX192 * amount, Q192)
    : div(Q192 * amount, ratioX192);
};

export const meanTick = (
  tickCumulatives: readonly [bigint, bigint],
  windowSeconds: number,
) => {
  const delta = tickCumulatives[1] - tickCumulatives[0];
  const window = BigInt(windowSeconds);
  let tick = delta / window;
  if (delta < 0n && delta % window !== 0n) {
    tick -= 1n;
  }

  return Number(tick);
};

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

  static readonly V2FactoryAbi = parseAbi([
    "function getPair(address tokenA, address tokenB) external view returns (address pair)",
  ]);

  static readonly V2PairAbi = parseAbi([
    "function getReserves() external view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)",
    "function price0CumulativeLast() external view returns (uint256)",
    "function price1CumulativeLast() external view returns (uint256)",
  ]);

  private static readonly factories = new Map<string, Address>();

  private getToken = (caip2Id: Caip2Id, tokenAddress: string) => {
    if (!common.isZeroAddress(tokenAddress)) return getAddress(tokenAddress);
    return getAddress(getChain(caip2Id).contracts.WETH9);
  };

  private ethCall = async (
    caip2Id: Caip2Id,
    to: string,
    data: Hex,
    blockNumber?: bigint,
  ) => {
    const onchainActor = getOnchainActor(getChain(caip2Id).type);
    const result = await onchainActor
      .ethCall(caip2Id, to, data, blockNumber)
      .catch(() => null);

    return !result || result === "0x" ? null : (result as Hex);
  };

  private getFactory = async (caip2Id: Caip2Id, router?: string) => {
    if (!router) {
      return null;
    }

    const key = `${caip2Id}:${router}`;
    const cached = Uniswap.factories.get(key);
    if (cached) {
      return cached;
    }

    const result = await this.ethCall(
      caip2Id,
      router,
      encodeFunctionData({
        abi: Uniswap.RouterAbi,
        functionName: "factory",
      }),
    );

    if (!result) {
      return null;
    }

    const factory = decodeFunctionResult({
      abi: Uniswap.RouterAbi,
      functionName: "factory",
      data: result,
    });

    if (common.isZeroAddress(factory)) {
      return null;
    }

    Uniswap.factories.set(key, factory);

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

    if (!poolResult) {
      return null;
    }

    const pool = decodeFunctionResult({
      abi: Uniswap.FactoryAbi,
      functionName: "getPool",
      data: poolResult,
    });

    if (common.isZeroAddress(pool)) {
      return null;
    }

    const liquidityResult = await this.ethCall(
      caip2Id,
      pool,
      encodeFunctionData({
        abi: Uniswap.PoolAbi,
        functionName: "liquidity",
      }),
    );

    if (!liquidityResult) {
      return null;
    }

    const liquidity = decodeFunctionResult({
      abi: Uniswap.PoolAbi,
      functionName: "liquidity",
      data: liquidityResult,
    });

    if (liquidity === 0n) {
      return null;
    }

    // pools only keep as much history as their observation cardinality allows,
    // so fall back to shorter windows before giving up on a pool.
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

      if (!observed) {
        continue;
      }

      const [cumulatives] = decodeFunctionResult({
        abi: Uniswap.PoolAbi,
        functionName: "observe",
        data: observed,
      });

      if (cumulatives.length === 2) {
        const tick = meanTick([cumulatives[0], cumulatives[1]], window);
        if (tick >= MinTick && tick <= MaxTick) {
          return {
            feeTier,
            liquidity,
            tick,
            window,
          };
        }
      }
    }

    return null;
  };

  getTwap = async (caip2Id: Caip2Id, tokenIn: string, tokenOut: string) => {
    const factory = await this.getFactory(
      caip2Id,
      getChain(caip2Id).contracts.Uniswap?.SwapRouter02,
    );

    if (!factory) {
      return null;
    }

    const tokenA = this.getToken(caip2Id, tokenIn);
    const tokenB = this.getToken(caip2Id, tokenOut);
    if (tokenA === tokenB) {
      return null;
    }

    const twaps = await Promise.all(
      UniswapFeeTiers.map((feeTier) =>
        this.getPoolTwap(caip2Id, factory, tokenA, tokenB, feeTier),
      ),
    );

    let best: (typeof twaps)[number] = null;
    for (const twap of twaps) {
      if (twap && (!best || twap.liquidity > best.liquidity)) {
        best = twap;
      }
    }

    return best
      ? {
          ...best,
          tokenIn: tokenA,
          tokenOut: tokenB,
        }
      : null;
  };

  private getV2Observation = async (
    caip2Id: Caip2Id,
    pair: Address,
    tokenInIsToken0: boolean,
    blockNumber: bigint,
  ) => {
    const cumulativeFunction = tokenInIsToken0
      ? "price0CumulativeLast"
      : "price1CumulativeLast";

    const [reservesResult, cumulativeResult, timestamp] = await Promise.all([
      this.ethCall(
        caip2Id,
        pair,
        encodeFunctionData({
          abi: Uniswap.V2PairAbi,
          functionName: "getReserves",
        }),
        blockNumber,
      ),
      this.ethCall(
        caip2Id,
        pair,
        encodeFunctionData({
          abi: Uniswap.V2PairAbi,
          functionName: cumulativeFunction,
        }),
        blockNumber,
      ),
      getOnchainActor(getChain(caip2Id).type)
        .getBlockTimestamp(caip2Id, blockNumber)
        .catch(() => null),
    ]);

    if (!reservesResult || !cumulativeResult || timestamp === null) {
      return null;
    }

    const [reserve0, reserve1, blockTimestampLast] = decodeFunctionResult({
      abi: Uniswap.V2PairAbi,
      functionName: "getReserves",
      data: reservesResult,
    });

    const reserveIn = tokenInIsToken0 ? reserve0 : reserve1;
    const reserveOut = tokenInIsToken0 ? reserve1 : reserve0;
    if (reserveIn === 0n || reserveOut === 0n) {
      return null;
    }

    const cumulative = decodeFunctionResult({
      abi: Uniswap.V2PairAbi,
      functionName: cumulativeFunction,
      data: cumulativeResult,
    });

    return {
      reserveIn,
      reserveOut,
      timestamp,
      cumulative: v2CumulativeAt(
        {
          cumulative,
          reserveIn,
          reserveOut,
          blockTimestampLast: BigInt(blockTimestampLast),
        },
        timestamp,
      ),
    };
  };

  getV2Twap = async (caip2Id: Caip2Id, tokenIn: string, tokenOut: string) => {
    const factory = await this.getFactory(
      caip2Id,
      getChain(caip2Id).contracts.Uniswap?.UniswapV2Router02,
    );

    if (!factory) {
      return null;
    }

    const tokenA = this.getToken(caip2Id, tokenIn);
    const tokenB = this.getToken(caip2Id, tokenOut);
    if (tokenA === tokenB) {
      return null;
    }

    const pairResult = await this.ethCall(
      caip2Id,
      factory,
      encodeFunctionData({
        abi: Uniswap.V2FactoryAbi,
        functionName: "getPair",
        args: [tokenA, tokenB],
      }),
    );

    if (!pairResult) {
      return null;
    }

    const pair = decodeFunctionResult({
      abi: Uniswap.V2FactoryAbi,
      functionName: "getPair",
      data: pairResult,
    });

    if (common.isZeroAddress(pair)) {
      return null;
    }

    const onchainActor = getOnchainActor(getChain(caip2Id).type);
    const latest = await onchainActor.getBlockNumber(caip2Id).catch(() => null);

    if (latest === null) {
      return null;
    }

    const tokenInIsToken0 = BigInt(tokenA) < BigInt(tokenB);
    const now = await this.getV2Observation(
      caip2Id,
      pair,
      tokenInIsToken0,
      latest,
    );

    if (!now) {
      return null;
    }

    // recent blocks tell how many blocks each window spans on this chain
    const sampleBlock = latest > 100n ? latest - 100n : 0n;
    const sampleTimestamp = await onchainActor
      .getBlockTimestamp(caip2Id, sampleBlock)
      .catch(() => null);

    if (sampleTimestamp === null || sampleTimestamp >= now.timestamp) {
      return null;
    }

    // RPCs only keep so much history, so fall back to shorter windows
    for (const window of UniswapTwapWindowsSeconds) {
      const blocksBack = common.ceilDiv(
        BigInt(window) * (latest - sampleBlock),
        now.timestamp - sampleTimestamp,
      );

      const past = await this.getV2Observation(
        caip2Id,
        pair,
        tokenInIsToken0,
        latest > blocksBack ? latest - blocksBack : 0n,
      );

      if (!past || past.timestamp >= now.timestamp) {
        continue;
      }

      const priceX112 = v2MeanPriceX112(
        past.cumulative,
        now.cumulative,
        now.timestamp - past.timestamp,
      );

      if (priceX112 > 0n) {
        return {
          priceX112,
          reserveIn: now.reserveIn,
          reserveOut: now.reserveOut,
          window,
        };
      }
    }

    return null;
  };

  // the average keeps a briefly moved pair from setting the price,
  // the current reserves add the price impact the average leaves out
  private quoteV2ExactInput = async (input: UniswapQuoterExactInputArgs) => {
    const twap = await this.getV2Twap(
      input.caip2Id,
      input.tokenIn,
      input.tokenOut,
    );

    if (!twap) {
      return null;
    }

    const atAverage =
      (input.amountIn * V2FeeNumerator * twap.priceX112) /
      (V2FeeDenominator * Q112);
    const atReserves = v2AmountOut(
      input.amountIn,
      twap.reserveIn,
      twap.reserveOut,
    );

    const amountOut = atAverage < atReserves ? atAverage : atReserves;

    return amountOut > 0n ? { feeTier: 0, amount: amountOut } : null;
  };

  private quoteV2ExactOutput = async (input: UniswapQuoterExactOutputArgs) => {
    const twap = await this.getV2Twap(
      input.caip2Id,
      input.tokenIn,
      input.tokenOut,
    );

    if (!twap) {
      return null;
    }

    const atReserves = v2AmountIn(
      input.amountOut,
      twap.reserveIn,
      twap.reserveOut,
    );

    if (atReserves === null) {
      return null;
    }

    const atAverage = common.ceilDiv(
      input.amountOut * Q112 * V2FeeDenominator,
      twap.priceX112 * V2FeeNumerator,
    );
    const amountIn = atAverage > atReserves ? atAverage : atReserves;

    return { feeTier: 0, amount: amountIn };
  };

  quoteExactInput = async (
    input: UniswapQuoterExactInputArgs,
  ): Promise<UniswapQuote | null> => {
    const twap = await this.getTwap(
      input.caip2Id,
      input.tokenIn,
      input.tokenOut,
    );

    if (!twap) return this.quoteV2ExactInput(input);

    const amountInLessFee =
      (input.amountIn * (FeeDenominator - BigInt(twap.feeTier))) /
      FeeDenominator;

    const amountOut = quoteAtTick(
      twap.tick,
      amountInLessFee,
      twap.tokenIn,
      twap.tokenOut,
    );

    return amountOut > 0n
      ? {
          feeTier: twap.feeTier,
          amount: amountOut,
        }
      : null;
  };

  quoteExactOutput = async (
    input: UniswapQuoterExactOutputArgs,
  ): Promise<UniswapQuote | null> => {
    const twap = await this.getTwap(
      input.caip2Id,
      input.tokenIn,
      input.tokenOut,
    );

    if (!twap) return this.quoteV2ExactOutput(input);

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

    return amountIn > 0n
      ? {
          feeTier: twap.feeTier,
          amount: amountIn,
        }
      : null;
  };
}
