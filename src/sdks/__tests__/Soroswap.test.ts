import { beforeEach, describe, expect, it } from "vitest";
import { scValToNative, type xdr } from "@stellar/stellar-sdk";
import { Soroswap } from "../Soroswap";
import { swapQuoter } from "../../shared/swapQuoter";
import { Chains, type StellarChain } from "../../shared/chains/registry";
import { fakeStellarActor, resetMocks } from "../../test/mocks";
import { env } from "../../shared/env";

const CAIP2 = "stellar:testnet" as Caip2Id;
const XLM = "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC";
const USDC = "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA";
const EURC = "CAEQSCIJBEEQSCIJBEEQSCIJBEEQSCIJBEEQSCIJBEEQSCIJBEEQTD2L";
const ROUTER = "CCJUD55AG6W5HAI5LRVNKAE5WDP5XGZBUDS5WNTIVDU7O264UZZE7BRD";

const router = (paths: Record<string, bigint[]>) => {
  fakeStellarActor.view.mockImplementation(async (...args: unknown[]) => {
    const [, contract, method, params] = args as [
      Caip2Id,
      string,
      string,
      xdr.ScVal[],
    ];
    if (contract !== ROUTER) throw new Error(`unexpected ${contract}`);
    const path = (scValToNative(params[1]) as string[]).join(">");
    const amounts = paths[path];
    if (!amounts) throw new Error("Error(Contract, #403)");
    expect(method).toMatch(/^router_get_amounts_(out|in)$/);
    return amounts;
  });
};

describe("Soroswap", () => {
  beforeEach(() => {
    resetMocks();
    env.KITE_IS_TESTNET = true;
  });

  it("tries the direct pair, then through USDC or XLM", () => {
    expect(new Soroswap().paths(CAIP2, EURC, USDC)).toEqual([
      [EURC, USDC],
      [EURC, XLM, USDC],
    ]);
    expect(new Soroswap().paths(CAIP2, XLM, USDC)).toEqual([[XLM, USDC]]);
  });

  it("quotes a direct pair", async () => {
    router({ [`${XLM}>${USDC}`]: [10_000_000n, 7_038_284n] });

    expect(
      await swapQuoter.quoteExactInput({
        caip2Id: CAIP2,
        tokenIn: XLM,
        tokenOut: USDC,
        amountIn: 10_000_000n,
      }),
    ).toEqual({ amount: 7_038_284n, feeTier: null, pool: `${XLM},${USDC}` });

    const [, , method] = fakeStellarActor.view.mock.calls[0];
    expect(method).toBe("router_get_amounts_out");
  });

  it("goes through a hub when it gives more, and quotes the input for an exact output", async () => {
    router({
      [`${EURC}>${USDC}`]: [12_000_000n, 10_000_000n],
      [`${EURC}>${XLM}>${USDC}`]: [11_000_000n, 15_000_000n, 10_000_000n],
    });

    expect(
      await swapQuoter.quoteExactOutput({
        caip2Id: CAIP2,
        tokenIn: EURC,
        tokenOut: USDC,
        amountOut: 10_000_000n,
      }),
    ).toEqual({
      amount: 11_000_000n,
      feeTier: null,
      pool: `${EURC},${XLM},${USDC}`,
    });
  });

  it("finds nothing when no pair has liquidity", async () => {
    router({});

    expect(
      await new Soroswap().quoteExactInput({
        caip2Id: CAIP2,
        tokenIn: XLM,
        tokenOut: USDC,
        amountIn: 1n,
      }),
    ).toBeNull();
  });

  it("refuses to swap where no router is configured", async () => {
    const chain = Chains[CAIP2] as StellarChain;
    const soroswap = chain.contracts.Soroswap;
    delete chain.contracts.Soroswap;

    try {
      await expect(
        swapQuoter.quoteExactOutput({
          caip2Id: CAIP2,
          tokenIn: XLM,
          tokenOut: USDC,
          amountOut: 1n,
        }),
      ).rejects.toThrow(/no Soroswap router.*pay in the settlement token/);

      // the settlement token itself never needs one
      expect(
        await new Soroswap().quoteExactInput({
          caip2Id: CAIP2,
          tokenIn: USDC,
          tokenOut: USDC,
          amountIn: 1n,
        }),
      ).toBeNull();
    } finally {
      chain.contracts.Soroswap = soroswap;
    }
  });
});
