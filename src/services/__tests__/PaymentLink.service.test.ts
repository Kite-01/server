import { beforeEach, describe, expect, it } from "vitest";
import { PaymentLinkType } from "../../shared/constants";
import { PaymentLinkService } from "../PaymentLink.service";
import { createApp } from "../../test/factories";

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
      mode: PaymentLinkType.Ui,
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
      mode: PaymentLinkType.Api,
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
});
