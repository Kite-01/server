import { beforeEach, describe, expect, it } from "vitest";
import { Rhea } from "../Rhea";
import { fakeNearActor, resetMocks } from "../../test/mocks";

const CAIP2 = "near:mainnet" as Caip2Id;
const USDC = "usdc.near";

describe("Rhea", () => {
  beforeEach(() => {
    resetMocks();
  });

  // amounts each fee tier's pool would give, or take
  const pools = (amounts: Record<number, string | null>) => {
    fakeNearActor.view.mockImplementation(async (...args: unknown[]) => {
      const [, , , params] = args as [
        Caip2Id,
        string,
        string,
        { pool_ids: string[] },
      ];
      const fee = Number(params.pool_ids[0].split("|")[2]);
      const amount = amounts[fee];
      if (amount === null) throw new Error("no such pool");
      return { amount: amount ?? "0", tag: null };
    });
  };

  it("names DCL pools with their tokens sorted", () => {
    expect(new Rhea().poolIds("wrap.near", USDC)).toEqual([
      "usdc.near|wrap.near|100",
      "usdc.near|wrap.near|400",
      "usdc.near|wrap.near|2000",
      "usdc.near|wrap.near|10000",
    ]);
  });

  it("quotes native NEAR as wrapped NEAR through the pool that gives the most", async () => {
    pools({ 100: "3838327", 400: "2499668", 2000: "3811669", 10000: null });

    expect(
      await new Rhea().quoteExactInput({
        caip2Id: CAIP2,
        tokenIn: "near",
        tokenOut: USDC,
        amountIn: 10n ** 24n,
      }),
    ).toEqual({ pool: "usdc.near|wrap.near|100", amount: 3_838_327n });

    expect(fakeNearActor.view).toHaveBeenCalledWith(
      CAIP2,
      "dclv2.ref-labs.near",
      "quote",
      expect.objectContaining({
        input_token: "wrap.near",
        output_token: USDC,
        input_amount: "1000000000000000000000000",
      }),
    );
  });

  it("asks the least for an exact output", async () => {
    pools({ 100: "300", 400: "250", 2000: "0" });

    expect(
      await new Rhea().quoteExactOutput({
        caip2Id: CAIP2,
        tokenIn: "near",
        tokenOut: USDC,
        amountOut: 1_000_000n,
      }),
    ).toEqual({ pool: "usdc.near|wrap.near|400", amount: 250n });
  });

  it("has no quote when no pool has liquidity", async () => {
    pools({});

    expect(
      await new Rhea().quoteExactInput({
        caip2Id: CAIP2,
        tokenIn: "near",
        tokenOut: USDC,
        amountIn: 1n,
      }),
    ).toBeNull();
  });
});
