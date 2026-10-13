import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../test/factories";
import { CustomerService } from "../Customer.service";

const service = new CustomerService();

describe("CustomerService", () => {
  let appId: string;
  let otherAppId: string;

  beforeEach(async () => {
    appId = (await createApp()).id;
    otherAppId = (await createApp()).id;
  });

  it("upserts by external id and keeps the same customer", async () => {
    const first = await service.upsertCustomer({
      appId,
      externalId: "u-1",
      name: "Ada",
      traits: { plan: "pro" },
    });

    const second = await service.upsertCustomer({
      appId,
      externalId: "u-1",
      name: "Ada L",
    });

    expect(second.id).toBe(first.id);
    expect(second.name).toBe("Ada L");
    expect(second.traits).toEqual({ plan: "pro" });
    expect((await service.getCustomers({ appId })).total).toBe(1);
  });

  it("keeps the same external id separate per app", async () => {
    const a = await service.upsertCustomer({ appId, externalId: "u-1" });
    const b = await service.upsertCustomer({
      appId: otherAppId,
      externalId: "u-1",
    });

    expect(a.id).not.toBe(b.id);
  });

  it("only returns a customer to its own app", async () => {
    const c = await service.upsertCustomer({ appId, externalId: "u-1" });

    expect(await service.getCustomerById(appId, c.id)).toMatchObject({
      id: c.id,
    });
    expect(await service.getCustomerById(otherAppId, c.id)).toBeUndefined();
    expect(await service.getCustomerByExternalId(appId, "u-1")).toMatchObject({
      id: c.id,
    });
    expect(
      await service.getCustomerByExternalId(otherAppId, "u-1"),
    ).toBeUndefined();
    expect(await service.deleteCustomer(otherAppId, c.id)).toBeUndefined();
  });

  it("filters by external id and search text", async () => {
    await service.upsertCustomer({ appId, externalId: "u-1", name: "Ada" });
    await service.upsertCustomer({ appId, externalId: "u-2", name: "Grace" });
    await service.upsertCustomer({
      appId: otherAppId,
      externalId: "u-3",
      name: "Grace",
    });

    expect(
      (await service.getCustomers({ appId, externalId: "u-2" })).data,
    ).toHaveLength(1);
    expect((await service.getCustomers({ appId, q: "grac" })).total).toBe(1);
    expect((await service.getCustomers({ appId, q: "u-" })).total).toBe(2);
    expect((await service.getCustomers({ q: "grace" })).total).toBe(2);
  });

  it("deletes and reports the deleted customer", async () => {
    const c = await service.upsertCustomer({ appId, externalId: "u-1" });

    expect((await service.deleteCustomer(appId, c.id))?.id).toBe(c.id);
    expect(await service.getCustomerById(appId, c.id)).toBeUndefined();
  });
});
