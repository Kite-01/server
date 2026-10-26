import {
  MaxTick,
  MinTick,
  meanTick,
  quoteAtTick,
  sqrtRatioAtTick,
  v2AmountIn,
  v2AmountOut,
  v2CumulativeAt,
  v2MeanPriceX112,
} from "../Uniswap";
import { describe, expect, it } from "vitest";

const Q96 = 2 ** 96;
const low = "0x0000000000000000000000000000000000000001";
const high = "0x0000000000000000000000000000000000000002";

describe("Uniswap TWAP math", () => {
  it("matches TickMath at its bounds and at tick zero", () => {
    expect(sqrtRatioAtTick(0)).toBe(79228162514264337593543950336n);
    expect(sqrtRatioAtTick(MinTick)).toBe(4295128739n);
    expect(sqrtRatioAtTick(MaxTick)).toBe(
      1461446703485210103287273052203988822378723970342n,
    );
  });

  it("follows sqrt(1.0001^tick) for every bit of the tick", () => {
    for (let bit = 0; bit < 20; bit++) {
      for (const tick of [1 << bit, -(1 << bit)]) {
        if (tick > MaxTick || tick < MinTick) continue;
        const expected = Math.sqrt(1.0001 ** tick) * Q96;
        const actual = Number(sqrtRatioAtTick(tick));
        expect(Math.abs(actual / expected - 1)).toBeLessThan(1e-9);
      }
    }
  });

  it("rejects ticks out of range", () => {
    expect(() => sqrtRatioAtTick(MaxTick + 1)).toThrow(RangeError);
    expect(() => sqrtRatioAtTick(0.5)).toThrow(RangeError);
  });

  it("rounds the mean tick towards negative infinity", () => {
    expect(meanTick([0n, 600n * 7n], 600)).toBe(7);
    expect(meanTick([0n, -600n * 7n], 600)).toBe(-7);
    expect(meanTick([0n, -4201n], 600)).toBe(-8);
    expect(meanTick([100n, 4300n], 600)).toBe(7);
  });

  it("quotes token0 in token1 and back at the tick price", () => {
    // token1 per token0 is 1.0001^tick.
    const tick = 6932; // ~2
    const price = 1.0001 ** tick;

    const out = quoteAtTick(tick, 10n ** 18n, low, high);
    expect(Number(out) / 1e18).toBeCloseTo(price, 9);

    const back = quoteAtTick(tick, 10n ** 18n, high, low);
    expect(Number(back) / 1e18).toBeCloseTo(1 / price, 9);
  });

  it("rounds up only when asked", () => {
    const down = quoteAtTick(1, 3n, low, high);
    const up = quoteAtTick(1, 3n, low, high, true);
    expect(up - down).toBe(1n);
    expect(quoteAtTick(0, 5n, low, high, true)).toBe(5n);
  });
});

describe("Uniswap V2 math", () => {
  const Q112 = 1n << 112n;
  const reserveIn = 100n * 10n ** 18n;
  const reserveOut = 300_000n * 10n ** 6n;

  it("charges the 0.3% fee and the price impact like UniswapV2Library", () => {
    expect(v2AmountOut(10n ** 18n, reserveIn, reserveOut)).toBe(2_961_474_103n);
    expect(v2AmountIn(2_000_000_000n, reserveIn, reserveOut)).toBe(
      673_160_420_859_895_122n,
    );
  });

  it("asks for the smallest input that buys the output", () => {
    const amountIn = v2AmountIn(2_000_000_000n, reserveIn, reserveOut)!;

    expect(v2AmountOut(amountIn, reserveIn, reserveOut)).toBeGreaterThanOrEqual(
      2_000_000_000n,
    );
    expect(v2AmountOut(amountIn - 1n, reserveIn, reserveOut)).toBeLessThan(
      2_000_000_000n,
    );
  });

  it("can't buy the whole reserve", () => {
    expect(v2AmountIn(reserveOut, reserveIn, reserveOut)).toBeNull();
  });

  it("accrues the current price since the pair last traded", () => {
    const observation = {
      cumulative: 7n,
      reserveIn,
      reserveOut,
      blockTimestampLast: 1_000n,
    };

    expect(v2CumulativeAt(observation, 1_060n)).toBe(
      7n + ((reserveOut * Q112) / reserveIn) * 60n,
    );
    expect(v2CumulativeAt(observation, 1_000n)).toBe(7n);
  });

  it("counts time across the pair's 32-bit timestamp wrap", () => {
    const observation = {
      cumulative: 0n,
      reserveIn: 1n,
      reserveOut: 1n,
      blockTimestampLast: 2n ** 32n - 10n,
    };

    expect(v2CumulativeAt(observation, 2n ** 32n + 5n)).toBe(Q112 * 15n);
  });

  it("averages the price over the window, even after the accumulator overflows", () => {
    expect(v2MeanPriceX112(Q112 * 10n, Q112 * 70n, 60n)).toBe(Q112);
    expect(v2MeanPriceX112(2n ** 256n - 100n, 500n, 6n)).toBe(100n);
  });
});
