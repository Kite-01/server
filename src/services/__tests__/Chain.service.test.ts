import {
  createApp,
  createConfiguredChain,
  createToken,
  FACTORY,
  USDC,
  address,
} from "../../test/factories";
import {
  ChainNotSupportedError,
  ProviderYetToBeConfiguredError,
  NotFoundError,
  AppError,
} from "../../shared/errors";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeActor, operatorAddress, resetMocks } from "../../test/mocks";
import { KeyType, KeyVars, Provider } from "../../shared/constants";
import { ChainService } from "../Chain.service";
import { KvService } from "../Kv.service";

const service = new ChainService();

const readContract = vi.fn();

const providerVars = async () => {
  const kv = new KvService();
  await kv.upsertKv({
    key: KeyVars.AlchemyApiKey,
    type: KeyType.SecureString,
    value: "a",
  });
  await kv.upsertKv({
    key: KeyVars.AlchemyGasPolicyId,
    type: KeyType.String,
    value: "p",
  });
  await kv.upsertKv({
    key: KeyVars.QuickNodeApiKey,
    type: KeyType.SecureString,
    value: "q",
  });
};

const config = (tokens: { settlement: string; usd: string }) => ({
  rpcUrls: ["https://rpc.example"],
  slippageBps: 100,
  kiteFactoryAddress: FACTORY.toLowerCase(),
  usdPeggedTokenId: tokens.usd,
  settlementTokenId: tokens.settlement,
  settlementAddress: null,
  onchainNotifierProviders: [Provider.QuickNode],
  gasSponsorProviders: [Provider.Alchemy],
});

describe("ChainService", () => {
  beforeEach(() => {
    resetMocks();
    readContract.mockReset();
    fakeActor.publicClient.mockResolvedValue({ readContract });
  });

  describe("chains", () => {
    it("creates a supported chain and rejects an unsupported one", async () => {
      const created = await service.createChain({ caip2Id: "eip155:8453" });

      expect(created).toMatchObject({ caip2Id: "eip155:8453", isActive: true });
      await expect(
        service.createChain({ caip2Id: "eip155:999999" }),
      ).rejects.toBeInstanceOf(ChainNotSupportedError);
    });

    it("allows one live chain per network, and a new one after deletion", async () => {
      const first = await service.createChain({ caip2Id: "eip155:8453" });

      await expect(
        service.createChain({ caip2Id: "eip155:8453" }),
      ).rejects.toThrow();

      await service.deleteChain(first.id);
      await expect(
        service.createChain({ caip2Id: "eip155:8453" }),
      ).resolves.toBeDefined();
    });

    it("finds chains by id and caip2 id, with config and tokens", async () => {
      const { chain, usdc } = await createConfiguredChain();

      const byId = await service.getChainById(chain.id);
      const byCaip = await service.getChainByCaip2Id("eip155:8453");

      expect(byId?.config?.settlementToken.id).toBe(usdc.id);
      expect(byCaip?.id).toBe(chain.id);
    });

    it("toggles a chain active and hides inactive ones from the active list", async () => {
      const { chain } = await createConfiguredChain();

      await service.updateChainActiveStatus(chain.id, false);
      expect(await service.getActiveChains()).toHaveLength(0);
      expect(await service.getChains()).toHaveLength(1);

      await service.updateChainActiveStatus(chain.id, true);
      expect(await service.getActiveChains()).toHaveLength(1);
    });

    it("soft deletes a chain once", async () => {
      const { chain } = await createConfiguredChain();

      expect((await service.deleteChain(chain.id))?.deletedAt).toBeInstanceOf(
        Date,
      );
      expect(await service.deleteChain(chain.id)).toBeUndefined();
      expect(await service.getChainById(chain.id)).toBeUndefined();
      expect(await service.getChains()).toHaveLength(0);
    });
  });

  describe("upsertChainConfig", () => {
    let chainId: string;
    let tokens: { settlement: string; usd: string };

    beforeEach(async () => {
      await providerVars();
      const created = await service.createChain({ caip2Id: "eip155:8453" });
      chainId = created.id;
      const usdc = await createToken(chainId, {
        address: USDC,
        symbol: "USDC",
        decimals: 6,
      });
      tokens = { settlement: usdc.id, usd: usdc.id };
      readContract.mockResolvedValue(true);
    });

    it("saves a normalised configuration and updates it in place", async () => {
      await service.upsertChainConfig(chainId, config(tokens));

      const saved = await service.getChainById(chainId);
      expect(saved?.config).toMatchObject({
        kiteFactoryAddress: FACTORY,
        slippageBps: 100,
        settlementAddress: null,
      });
      expect(readContract).toHaveBeenCalledWith(
        expect.objectContaining({
          functionName: "hasRole",
          address: FACTORY,
          args: [expect.any(String), operatorAddress],
        }),
      );

      await service.upsertChainConfig(chainId, {
        ...config(tokens),
        slippageBps: 250,
        settlementAddress: address(0x5e77).toLowerCase(),
      });

      const updated = await service.getChainById(chainId);
      expect(updated?.config?.slippageBps).toBe(250);
      expect(updated?.config?.settlementAddress).toBe(address(0x5e77));
    });

    it("rejects an unknown chain", async () => {
      await expect(
        service.upsertChainConfig(crypto.randomUUID(), config(tokens)),
      ).rejects.toBeInstanceOf(NotFoundError);
    });

    it.each([-1, 9901])("rejects slippage of %s bps", async (slippageBps) => {
      await expect(
        service.upsertChainConfig(chainId, { ...config(tokens), slippageBps }),
      ).rejects.toThrow("Slippage must be between 0 and 9900 Bps");
    });

    it("rejects malformed addresses", async () => {
      await expect(
        service.upsertChainConfig(chainId, {
          ...config(tokens),
          kiteFactoryAddress: "0x123",
        }),
      ).rejects.toThrow("KiteFactory address is not a valid address");

      await expect(
        service.upsertChainConfig(chainId, {
          ...config(tokens),
          settlementAddress: "nope",
        }),
      ).rejects.toThrow("settlement address is not a valid address");
    });

    it("says so when the server wallet is not an operator", async () => {
      readContract.mockResolvedValue(false);

      await expect(
        service.upsertChainConfig(chainId, config(tokens)),
      ).rejects.toThrow(
        "Server wallet is not a configured operator on provided KiteFactory",
      );
    });

    it("says so when the factory cannot be read", async () => {
      readContract.mockRejectedValue(new Error("execution reverted"));

      await expect(
        service.upsertChainConfig(chainId, config(tokens)),
      ).rejects.toThrow("Is this a valid KiteFactory contract?");
    });

    it("requires the chosen providers to be configured", async () => {
      await new KvService().deleteKv(KeyVars.AlchemyGasPolicyId);

      await expect(
        service.upsertChainConfig(chainId, config(tokens)),
      ).rejects.toBeInstanceOf(ProviderYetToBeConfiguredError);
    });

    it("says so when the gas sponsor cannot sponsor calls on the chain", async () => {
      fakeActor.canSponsorCalls.mockResolvedValue(false);

      await expect(
        service.upsertChainConfig(chainId, config(tokens)),
      ).rejects.toThrow("Alchemy cannot sponsor gas on Base");

      expect(fakeActor.canSponsorCalls).toHaveBeenCalledWith(
        "eip155:8453",
        Provider.Alchemy,
        {
          variables: expect.objectContaining({
            [KeyVars.AlchemyGasPolicyId]: "p",
          }),
        },
      );
      expect((await service.getChainById(chainId))?.config).toBeNull();
    });

    it("does not save anything when validation fails", async () => {
      await expect(
        service.upsertChainConfig(chainId, {
          ...config(tokens),
          slippageBps: -5,
        }),
      ).rejects.toBeInstanceOf(AppError);

      expect((await service.getChainById(chainId))?.config).toBeNull();
    });

    it("refuses settlement tokens that belong to another chain", async () => {
      const other = await service.createChain({ caip2Id: "eip155:1" });
      const foreign = await createToken(other.id);

      await expect(
        service.upsertChainConfig(chainId, {
          ...config(tokens),
          settlementTokenId: foreign.id,
        }),
      ).rejects.toThrow();
    });
  });

  it("is untouched by app data", async () => {
    await createApp();
    expect(await service.getChains()).toEqual([]);
  });
});
