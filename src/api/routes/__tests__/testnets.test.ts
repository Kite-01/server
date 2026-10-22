import {
  address,
  createApp,
  createChain,
  createConfiguredChain,
  createPaymentLink,
} from "../../../test/factories";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { call, client, rootCredentials } from "../../../test/api";
import { fakeActor, resetMocks } from "../../../test/mocks";
import { Uniswap } from "../../../sdks/Uniswap";
import { env } from "../../../shared/env";

const root = client(rootCredentials());

describe("testnets", () => {
  beforeEach(() => {
    resetMocks();
  });

  afterEach(() => {
    env.KITE_IS_TESTNET = false;
  });

  it("offers only mainnets by default", async () => {
    const res = await root.get("/api/chains/supported");

    expect(res.status).toBe(200);
    expect(res.json.length).toBeGreaterThan(0);
    expect(res.json.every((chain: any) => !chain.testnet)).toBe(true);

    const created = await root.post("/api/chains", {
      caip2Id: "eip155:11155111",
    });
    expect(created.status).toBe(422);
  });

  describe("with KITE_TESTNETS", () => {
    beforeEach(() => {
      env.KITE_IS_TESTNET = true;
    });

    it("offers only testnets", async () => {
      const res = await root.get("/api/chains/supported");

      expect(res.json.length).toBeGreaterThan(0);
      expect(
        res.json.every((chain: { testnet: boolean }) => chain.testnet === true),
      ).toBe(true);
    });

    it("adds a testnet and refuses a mainnet", async () => {
      const testnet = await root.post("/api/chains", {
        caip2Id: "eip155:10143",
      });
      expect(testnet.status).toBe(201);

      const mainnet = await root.post("/api/chains", {
        caip2Id: "eip155:8453",
      });
      expect(mainnet.status).toBe(422);
    });

    it("hides mainnet chains already in the database instead of failing", async () => {
      await createConfiguredChain("eip155:8453");
      const sepolia = await createChain("eip155:11155111");

      const full = await root.get("/api/chains/full");
      expect(full.json.map((chain: any) => chain.id)).toEqual([sepolia.id]);

      const info = await root.get("/api/overview/info");
      expect(info.status).toBe(200);
      expect(info.json.chains).toEqual([
        expect.objectContaining({ id: sepolia.id, name: "Sepolia" }),
      ]);
    });

    it("marks checkout networks as testnets", async () => {
      await createConfiguredChain("eip155:11155111");
      const link = await createPaymentLink((await createApp()).id);

      const res = await call("GET", `/api/checkout/${link.id}`, {});

      expect(res.status).toBe(200);
      expect(res.json.chains).toEqual([
        expect.objectContaining({
          caip2Id: "eip155:11155111",
          name: "Sepolia",
          testnet: true,
        }),
      ]);
    });

    it("has no swap quotes where Uniswap isn't deployed", async () => {
      const quote = await new Uniswap().quoteExactInput({
        caip2Id: "eip155:10143",
        tokenIn: address(0x1),
        tokenOut: address(0x2),
        amountIn: 1_000_000n,
      });

      expect(quote).toBeNull();
      expect(fakeActor.ethCall).not.toHaveBeenCalled();
    });
  });
});
