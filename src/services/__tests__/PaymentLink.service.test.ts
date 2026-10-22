import { createQuoteRow, createTransferRow } from "../../test/transfers";
import { createApp, createConfiguredChain } from "../../test/factories";
import { PaymentLinkUsage, TransferStatus } from "../../shared/constants";
import { beforeEach, describe, expect, it } from "vitest";
import { PaymentLinkService } from "../PaymentLink.service";
import { PreconditionError } from "../../shared/errors";

const service = new PaymentLinkService();

describe("PaymentLinkService", () => {
  let appId: string;
  let otherAppId: string;

  beforeEach(async () => {
    appId = (await createApp()).id;
    otherAppId = (await createApp()).id;
  });

  const create = (
    values: Partial<Parameters<typeof service.createPaymentLink>[0]> = {},
  ) =>
    service.createPaymentLink({
      appId,
      title: "Pro plan",
      currency: "USD",
      amount: "49.99",
      ...values,
    });

  it("creates a link and keeps decimal precision", async () => {
    const link = await create({ amount: "0.000000000000000001" });

    expect(link.title).toBe("Pro plan");
    expect(link.amount).toBe("0.000000000000000001");
    expect(link.lineItems).toBeNull();
  });

  it("stores line items as json", async () => {
    const link = await create({
      lineItems: [{ name: "Seat", quantity: 2 }],
    });

    expect(link.lineItems).toEqual([{ name: "Seat", quantity: 2 }]);
  });

  it("updates fields and bumps updatedAt", async () => {
    const link = await create();
    const updated = await service.updatePaymentLink(appId, link.id, {
      title: "Team plan",
      amount: "99",
    });

    expect(updated).toMatchObject({
      title: "Team plan",
      amount: "99.000000000000000000",
    });
    expect(updated!.updatedAt.getTime()).toBeGreaterThanOrEqual(
      link.updatedAt.getTime(),
    );
  });

  it("is invisible and immutable to other apps", async () => {
    const link = await create();

    expect(await service.getPaymentLink(otherAppId, link.id)).toBeUndefined();
    expect(
      await service.updatePaymentLink(otherAppId, link.id, { title: "x" }),
    ).toBeUndefined();
    expect(
      await service.deletePaymentLink(otherAppId, link.id),
    ).toBeUndefined();
    expect((await service.getPaymentLink(appId, link.id))?.title).toBe(
      "Pro plan",
    );
  });

  it("lists with search, scoped to the app", async () => {
    await create({ title: "Pro plan" });
    await create({ title: "Team plan" });
    await service.createPaymentLink({
      appId: otherAppId,
      title: "Pro plan",
      currency: "USD",
      amount: "1",
    });

    expect((await service.getPaymentLinks({ appId })).total).toBe(2);
    expect((await service.getPaymentLinks({ appId, q: "team" })).total).toBe(1);
    expect((await service.getPaymentLinks({})).total).toBe(3);
  });

  it("deletes and reports the deleted link", async () => {
    const link = await create();

    expect((await service.deletePaymentLink(appId, link.id))?.id).toBe(link.id);
    expect(await service.getPaymentLink(appId, link.id)).toBeUndefined();
  });

  it("makes links one-time unless they are created reusable", async () => {
    const link = await create();
    const reusable = await create({ usage: PaymentLinkUsage.Reusable });

    expect(link.usage).toBe(PaymentLinkUsage.OneTime);
    expect(reusable.usage).toBe(PaymentLinkUsage.Reusable);

    const updated = await service.updatePaymentLink(appId, link.id, {
      usage: PaymentLinkUsage.Reusable,
    });

    expect(updated?.usage).toBe(PaymentLinkUsage.Reusable);
  });

  it("rejects an unknown usage", async () => {
    await expect(
      create({ usage: "Twice" as PaymentLinkUsage }),
    ).rejects.toThrow();
  });

  describe("assertPayable", () => {
    let chain: Awaited<ReturnType<typeof createConfiguredChain>>;

    beforeEach(async () => {
      chain = await createConfiguredChain();
    });

    const transferFrom = async (
      paymentLinkId: string,
      status = TransferStatus.Settled,
    ) => {
      const quote = await createQuoteRow({
        appId,
        chainId: chain.chain.id,
        sourceTokenId: chain.usdc.id,
        targetTokenId: chain.usdc.id,
        paymentLinkId,
      });

      return createTransferRow({ appId, quote, status });
    };

    it("lets a one-time link be paid while its transfers await a deposit", async () => {
      const link = await create();
      await expect(service.assertPayable(link)).resolves.toBeUndefined();

      await transferFrom(link.id, TransferStatus.AwaitingDeposit);
      await expect(service.assertPayable(link)).resolves.toBeUndefined();
    });

    it.each([
      TransferStatus.DepositReceived,
      TransferStatus.Processing,
      TransferStatus.x402Settled,
      TransferStatus.Settled,
      TransferStatus.Cancelled,
      TransferStatus.Failed,
      TransferStatus.Refunded,
    ])("uses up a one-time link once a transfer is %s", async (status) => {
      const link = await create();
      await transferFrom(link.id, status);

      await expect(service.assertPayable(link)).rejects.toBeInstanceOf(
        PreconditionError,
      );
    });

    it("keeps a reusable link payable after it has been paid", async () => {
      const link = await create({ usage: PaymentLinkUsage.Reusable });
      await transferFrom(link.id);

      await expect(service.assertPayable(link)).resolves.toBeUndefined();
    });

    it("ignores other links' transfers", async () => {
      const link = await create();
      const other = await create();
      await transferFrom(other.id);

      await expect(service.assertPayable(link)).resolves.toBeUndefined();
    });
  });
});
