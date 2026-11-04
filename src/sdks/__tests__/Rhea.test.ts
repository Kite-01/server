import { beforeEach, describe, expect, it } from "vitest";
import { Rhea } from "../Rhea";
import { fakeNearActor, resetMocks } from "../../test/mocks";
import { env } from "../../shared/env";

const CAIP2 = "near:testnet" as Caip2Id;
const USDC = "usdc.near";

describe("Rhea", () => {
  beforeEach(() => {
    resetMocks();
    env.KITE_IS_TESTNET = true;
  });

  const pools = (amounts: Record<number, string | null>) => {
    fakeNearActor.view.mockImplementation(async (...args: unknown[]) => {
      const [, , method, params] = args as [
        Caip2Id,
        string,
        string,
        { pool_ids?: string[]; pool_id?: string },
      ];
      const pool = params.pool_id ?? params.pool_ids![0];
      const amount = amounts[Number(pool.split("|")[2])];
      if (method === "get_pool") return amount === undefined ? null : { pool };
      if (amount === null) throw new Error("no such pool");
      return { amount: amount ?? "0", tag: null };
    });
  };

  it("names DCL pools with their tokens sorted", () => {
    expect(new Rhea().poolIds("wrap.testnet", USDC)).toEqual([
      "usdc.near|wrap.testnet|100",
      "usdc.near|wrap.testnet|400",
      "usdc.near|wrap.testnet|2000",
      "usdc.near|wrap.testnet|10000",
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
    ).toEqual({ pool: "usdc.near|wrap.testnet|100", amount: 3_838_327n });

    expect(fakeNearActor.view).toHaveBeenCalledWith(
      CAIP2,
      "dclv2.ref-dev.testnet",
      "quote",
      expect.objectContaining({
        input_token: "wrap.testnet",
        output_token: USDC,
        input_amount: "1000000000000000000000000",
      }),
    );
  });

  it("quotes only the pools that exist", async () => {
    pools({ 2000: "3811669" });

    await new Rhea().quoteExactInput({
      caip2Id: CAIP2,
      tokenIn: "near",
      tokenOut: USDC,
      amountIn: 10n ** 24n,
    });

    const quoted = fakeNearActor.view.mock.calls
      .filter(([, , method]) => method === "quote")
      .map(([, , , params]) => (params as { pool_ids: string[] }).pool_ids[0]);
    expect(quoted).toEqual(["usdc.near|wrap.testnet|2000"]);
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
    ).toEqual({ pool: "usdc.near|wrap.testnet|400", amount: 250n });
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
