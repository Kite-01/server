import { beforeEach, describe, expect, it } from "vitest";
import { client, rootCredentials } from "../../../test/api";
import { fakeGnoActor, resetMocks } from "../../../test/mocks";
import { GNO_NS, setupGnoChain } from "../../../test/gno";

const root = client(rootCredentials());

describe("Gno.land chains", () => {
  beforeEach(() => resetMocks());

  it("adds a GRC20 by its registry key, slashes and all", async () => {
    const { chainId } = await setupGnoChain();
    const key = `gno.land/r/${GNO_NS}/usdc.USDC`;
    fakeGnoActor.getTokenMetadata.mockResolvedValue({
      name: "USD Coin",
      symbol: "USDC",
      decimals: 6,
    });

    const res = await root.get(
      `/api/tokens/${chainId}/${encodeURIComponent(key)}`,
    );

    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({ address: key, symbol: "USDC" });
    expect(fakeGnoActor.getTokenMetadata).toHaveBeenCalledWith(
      "gno:onyx-1",
      key,
      expect.any(Array),
    );
  });

  it("refuses a g1 address as a token", async () => {
    const { chainId } = await setupGnoChain();
    const res = await root.get(
      `/api/tokens/${chainId}/g1d4jhycmgv9h8gh6lta047h6lta047h6lsu9czk`,
    );
    expect(res.status).toBeGreaterThanOrEqual(400);
  });
});
