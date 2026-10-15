import {
  MaxTick,
  MinTick,
  meanTick,
  quoteAtTick,
  sqrtRatioAtTick,
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
