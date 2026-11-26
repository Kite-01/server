import { beforeEach, describe, expect, it } from "vitest";
import { swapQuoter } from "../../shared/swapQuoter";
import { fakeGnoActor, resetMocks } from "../../test/mocks";
import { env } from "../../shared/env";

const CAIP2 = "gno:onyx-1" as Caip2Id;
const WUGNOT = "gno.land/r/gnoland/wugnot.wugnot";
const GNS = "gno.land/r/gnoswap/gns.GNS";
const POOL = `${WUGNOT}:${GNS}:3000`;

const chain = (dry: Record<string, string>, tick = 15211) => {
  fakeGnoActor.qeval.mockImplementation(async (...args: unknown[]) => {
    const [, pkg, expr] = args as [Caip2Id, string, string];
    if (pkg === "gno.land/r/gnoswap/pool") {
      if (expr === `GetLiquidity("${POOL}")`) return '("17954137490" string)';
      if (expr.startsWith(`Observe("${POOL}", []uint32{600, 0})`)) {
        const start = 36_919_164_264n;
        return `(slice[(${start} int64),(${start + BigInt(tick * 600)} int64)] []int64)\n(slice[("1" string),("2" string)] []string)\n(undefined)`;
      }

      throw new Error("pool not found");
    }

    if (pkg === "gno.land/r/gnoswap/router") {
      const key = Object.keys(dry).find((k) => expr.includes(k));
      if (!key) throw new Error(`unexpected ${expr}`);
      return dry[key];
    }

    throw new Error(`unexpected ${pkg}`);
  });
};

describe("GnoSwap", () => {
  beforeEach(() => {
    resetMocks();
    env.KITE_IS_TESTNET = true;
  });

  it("quotes GNOT through wugnot, at the lower of the dry run and the average", async () => {
    chain({
      '"1000000", "EXACT_IN"':
        '("1000000" string)\n("4556245" string)\n(undefined)',
    });

    expect(
      await swapQuoter.quoteExactInput({
        caip2Id: CAIP2,
        tokenIn: "ugnot",
        tokenOut: GNS,
        amountIn: 1_000_000n,
      }),
    ).toEqual({ amount: 4_556_245n, feeTier: null, pool: POOL });

    const [, , expr] = fakeGnoActor.qeval.mock.calls.find(
      (call) => call[1] === "gno.land/r/gnoswap/router",
    )! as [Caip2Id, string, string];
    expect(expr).toBe(
      `DrySwapRoute("${WUGNOT}", "${GNS}", "1000000", "EXACT_IN", "${POOL}", "100", "0")`,
    );
  });

  it("doesn't let a moved pool set the price", async () => {
    // the pool now pays twice the average
    chain({
      '"1000000", "EXACT_IN"':
        '("1000000" string)\n("9112490" string)\n(undefined)',
    });

    const quote = await swapQuoter.quoteExactInput({
      caip2Id: CAIP2,
      tokenIn: "ugnot",
      tokenOut: GNS,
      amountIn: 1_000_000n,
    });
    expect(quote!.amount).toBeGreaterThan(4_500_000n);
    expect(quote!.amount).toBeLessThan(4_600_000n);
  });

  it("quotes the other way, with the route in swap order", async () => {
    chain({
      [`"${GNS}:${WUGNOT}:3000"`]:
        '("4556245" string)\n("990794" string)\n(undefined)',
    });

    expect(
      await swapQuoter.quoteExactInput({
        caip2Id: CAIP2,
        tokenIn: GNS,
        tokenOut: "ugnot",
        amountIn: 4_556_245n,
      }),
    ).toEqual({
      amount: 990_794n,
      feeTier: null,
      pool: `${GNS}:${WUGNOT}:3000`,
    });
  });

  it("quotes an exact output at the higher input", async () => {
    chain({
      '"EXACT_OUT"': '("1000000" string)\n("4556245" string)\n(undefined)',
    });

    const quote = await swapQuoter.quoteExactOutput({
      caip2Id: CAIP2,
      tokenIn: "ugnot",
      tokenOut: GNS,
      amountOut: 4_556_245n,
    });
    expect(quote!.amount).toBeGreaterThanOrEqual(1_000_000n);
    expect(quote!.amount).toBeLessThan(1_010_000n);
  });

  it("has no quote without a pool, or when the dry run fails", async () => {
    chain({});
    expect(
      await swapQuoter.quoteExactInput({
        caip2Id: CAIP2,
        tokenIn: "ugnot",
        tokenOut: "gno.land/r/demo/foo20.FOO",
        amountIn: 1n,
      }),
    ).toBeNull();

    chain({
      '"EXACT_IN"':
        '("0" string)\n("0" string)\n(&(struct{("halted" string)} errors.errorString) *errors.errorString)',
    });
    expect(
      await swapQuoter.quoteExactInput({
        caip2Id: CAIP2,
        tokenIn: "ugnot",
        tokenOut: GNS,
        amountIn: 1_000_000n,
      }),
    ).toBeNull();
  });
});
