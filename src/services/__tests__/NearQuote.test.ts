import { beforeEach, describe, expect, it } from "vitest";
import { createPaymentLink } from "../../test/factories";
import { setupNearChain, NEAR_USDC } from "../../test/near";
import { fakeNearActor, resetMocks } from "../../test/mocks";
import { QuoteService } from "../Quote.service";

describe("quotes on NEAR", () => {
  let appId: string;
  let chainId: string;

  beforeEach(async () => {
    resetMocks();
    ({ appId, chainId } = await setupNearChain());
  });

  it("rounds a payment link's amount in NEAR up to 6 decimals", async () => {
    fakeNearActor.view.mockImplementation(async (...args: unknown[]) =>
      args[2] === "quote_by_output"
        ? { amount: "7325763748910487055142", tag: null }
        : null,
    );
    const link = await createPaymentLink(appId, {
      currency: "USD",
      amount: "0.05",
    });

    const quote = await new QuoteService().createQuoteFromPaymentLink(
      appId,
      link.id,
      { chainId, sourceTokenAddress: "near" },
    );

    expect(quote.sourceAmount).toBe(7_326_000_000_000_000_000_000n);
    expect(quote.targetAmount).toBe(50_000n);
    expect(quote.swapPool).toMatch(
      new RegExp(`^${NEAR_USDC}\\|wrap\\.testnet\\|`),
    );
  });
});
