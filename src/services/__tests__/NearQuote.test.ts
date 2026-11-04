import { beforeEach, describe, expect, it } from "vitest";
import { createPaymentLink } from "../../test/factories";
import { setupNearChain, NEAR_USDC } from "../../test/near";
import { fakeNearActor, resetMocks, schedulerMock } from "../../test/mocks";
import { QuoteService } from "../Quote.service";
import { TransferService } from "../Transfer.service";
import { CheckoutService } from "../Checkout.service";

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
        : args[2] === "get_pool"
          ? {}
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

  it("looks for the deposit whenever the checkout polls the transfer", async () => {
    const chainViews = fakeNearActor.view.getMockImplementation()!;
    fakeNearActor.view.mockImplementation(async (...args: unknown[]) =>
      args[2] === "quote_by_output"
        ? { amount: "7325763748910487055142", tag: null }
        : args[2] === "get_pool"
          ? {}
          : chainViews(...args),
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
    const created = await new TransferService().createTransfer(
      appId,
      quote.id,
      "payer.near",
    );
    schedulerMock.enqueueSettle.mockClear();

    await new CheckoutService().getTransfer(link.id, created.id);

    expect(schedulerMock.enqueueSettle).toHaveBeenCalledWith(created.id);
  });
});
