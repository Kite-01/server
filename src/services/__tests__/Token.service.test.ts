import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createConfiguredChain,
  createToken,
  address,
  ZERO,
} from "../../test/factories";
import { AppError, NotFoundError } from "../../shared/errors";
import { fakeActor, resetMocks } from "../../test/mocks";
import { TokenService } from "../Token.service";

const httpGet = vi.hoisted(() => vi.fn());

vi.mock("../sdks/Http", () => ({
  Http: class {
    get = httpGet;
  },
}));

const service = new TokenService();
const multicall = vi.fn();

const TOKEN = address(0x7070);

describe("TokenService", () => {
  let chainId: string;

  beforeEach(async () => {
    resetMocks();
    httpGet.mockReset();
    multicall.mockReset();
    fakeActor.publicClient.mockResolvedValue({ multicall });
    chainId = (await createConfiguredChain()).chain.id;
  });

  describe("findTokenByAddress", () => {
    it("matches regardless of address casing", async () => {
      const created = await createToken(chainId, { address: TOKEN });

      expect(
        (await service.findTokenByAddress(chainId, TOKEN.toLowerCase()))?.id,
      ).toBe(created.id);
    });

    it("ignores malformed addresses and other chains", async () => {
      await createToken(chainId, { address: TOKEN });
      const other = (await createConfiguredChain("eip155:1")).chain.id;

      expect(
        await service.findTokenByAddress(chainId, "0x1234"),
      ).toBeUndefined();
      expect(await service.findTokenByAddress(other, TOKEN)).toBeUndefined();
    });
  });

  describe("getTokenByAddress", () => {
    it("returns a known token without any network call", async () => {
      const created = await createToken(chainId, { address: TOKEN });

      expect((await service.getTokenByAddress(chainId, TOKEN)).id).toBe(
        created.id,
      );
      expect(httpGet).not.toHaveBeenCalled();
      expect(multicall).not.toHaveBeenCalled();
    });

    it("rejects a chain that does not exist", async () => {
      await expect(
        service.getTokenByAddress(crypto.randomUUID(), TOKEN),
      ).rejects.toBeInstanceOf(NotFoundError);
    });

    it("saves the chain's native currency for the zero address", async () => {
      const saved = await service.getTokenByAddress(chainId, ZERO);

      expect(saved).toMatchObject({
        address: ZERO,
        symbol: "ETH",
        decimals: 18,
        supportsEIP3009: false,
      });
      expect(httpGet).not.toHaveBeenCalled();
    });

    it("uses the Trust Wallet metadata and detects EIP-3009 support", async () => {
      multicall.mockResolvedValueOnce([
        { result: "Wrapped Thing" },
        { result: "2" },
        { result: false },
      ]);
      httpGet.mockResolvedValue({
        isOk: true,
        data: { name: "Wrapped Thing", symbol: "WTH", decimals: 8 },
      });

      const saved = await service.getTokenByAddress(
        chainId,
        TOKEN.toLowerCase(),
      );

      expect(saved).toMatchObject({
        address: TOKEN,
        symbol: "WTH",
        decimals: 8,
        name: "Wrapped Thing",
        version: "2",
        supportsEIP3009: true,
      });
      expect(saved.icon).toContain(TOKEN);
    });

    it("falls back to reading the token on-chain", async () => {
      multicall
        .mockResolvedValueOnce([
          { result: undefined },
          { result: undefined },
          { result: undefined },
        ])
        .mockResolvedValueOnce([
          { result: "Plain Token" },
          { result: "PLN" },
          { result: 12 },
        ]);
      httpGet.mockResolvedValue({ isOk: false });

      const saved = await service.getTokenByAddress(chainId, TOKEN);

      expect(saved).toMatchObject({
        symbol: "PLN",
        decimals: 12,
        name: "Plain Token",
        supportsEIP3009: false,
        version: null,
      });
    });

    it("fails when the contract is not a token", async () => {
      multicall.mockResolvedValue([
        { result: undefined },
        { result: undefined },
        { result: undefined },
      ]);
      httpGet.mockResolvedValue({ isOk: false });

      await expect(service.getTokenByAddress(chainId, TOKEN)).rejects.toThrow(
        new AppError("Could not get meta information for token"),
      );
    });

    it("saves a token once when requested concurrently", async () => {
      multicall.mockResolvedValue([
        { result: "N" },
        { result: "1" },
        { result: false },
      ]);
      httpGet.mockResolvedValue({
        isOk: true,
        data: { name: "N", symbol: "N", decimals: 6 },
      });

      const [a, b] = await Promise.all([
        service.getTokenByAddress(chainId, TOKEN),
        service.getTokenByAddress(chainId, TOKEN),
      ]);

      expect(a.id).toBe(b.id);
      expect(
        (await service.getTokens({ chainId })).data.filter(
          (t) => t.address === TOKEN,
        ),
      ).toHaveLength(1);
    });
  });

  describe("lists", () => {
    it("searches by symbol, name or address and filters by chain", async () => {
      const otherChain = (await createConfiguredChain("eip155:1")).chain.id;
      await createToken(chainId, { symbol: "DAI", name: "Dai Stablecoin" });
      await createToken(otherChain, { symbol: "DAIX", name: "Other" });

      expect((await service.getTokens({ q: "dai" })).total).toBe(2);
      expect((await service.getTokens({ chainId, q: "stable" })).total).toBe(1);
      expect((await service.getTokens({ chainId })).total).toBe(2);
      expect((await service.getTokensByChainId(chainId)).length).toBe(2);
    });
  });

  describe("deleteToken", () => {
    it("deletes an unused token", async () => {
      const created = await createToken(chainId);

      expect((await service.deleteToken(created.id))?.id).toBe(created.id);
      expect(await service.getTokenById(created.id)).toBeUndefined();
    });

    it("refuses to delete a token a chain is configured with", async () => {
      const { usdc } = await createConfiguredChain("eip155:10");

      await expect(service.deleteToken(usdc.id)).rejects.toThrow();
    });
  });

  describe("isAuthorizationUsed", () => {
    it("reads the authorization state and reports unreadable as null", async () => {
      const readContract = vi
        .fn()
        .mockResolvedValueOnce(true)
        .mockRejectedValueOnce(new Error("x"));
      fakeActor.publicClient.mockResolvedValue({ readContract });
      const nonce = `0x${"11".repeat(32)}`;

      expect(
        await service.isAuthorizationUsed(
          "eip155:8453",
          TOKEN,
          address(1),
          nonce,
        ),
      ).toBe(true);
      expect(
        await service.isAuthorizationUsed(
          "eip155:8453",
          TOKEN,
          address(1),
          nonce,
        ),
      ).toBeNull();
    });
  });
});
