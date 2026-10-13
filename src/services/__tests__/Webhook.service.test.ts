import { beforeEach, describe, expect, it } from "vitest";
import { WebhookCategory } from "../../shared/constants";
import { createApp } from "../../test/factories";
import { WebhookService } from "../Webhook.service";
import { crypt } from "../../shared/crypt";
import { eventFor } from "../../test/events";
import { webhook } from "../../db/schema";
import { db } from "../../db";

const service = new WebhookService();

describe("WebhookService", () => {
  let appId: string;
  let otherAppId: string;

  beforeEach(async () => {
    appId = (await createApp()).id;
    otherAppId = (await createApp()).id;
  });

  const create = (
    values: Partial<Parameters<typeof service.createWebhook>[0]> = {},
  ) =>
    service.createWebhook({
      appId,
      url: "https://example.com/hook",
      label: "main",
      categories: [WebhookCategory.Transfer],
      ...values,
    });

  it("returns the signing secret once and stores it encrypted", async () => {
    const created = await create();

    expect(created.signingKey).toMatch(/^whsec_/);
    expect(created.signingKeyHint).toBe(
      `whsec_...${created.signingKey.slice(-4)}`,
    );

    const [stored] = await db.select().from(webhook);
    expect(stored.signingKey).not.toContain(created.signingKey);
    expect(stored.signingKey.startsWith("cipher.")).toBe(true);
    expect(crypt.decrypt(stored.signingKey)).toBe(created.signingKey);
  });

  it("generates a different secret per webhook", async () => {
    const a = await create({ url: "https://a.example/hook" });
    const b = await create({ url: "https://b.example/hook" });

    expect(a.signingKey).not.toBe(b.signingKey);
  });

  it("rejects the same url twice for an app until the first is deleted", async () => {
    const first = await create();
    await expect(create()).rejects.toThrow();

    await service.deleteWebhook(appId, first.id);
    await expect(create()).resolves.toMatchObject({
      url: "https://example.com/hook",
    });
    await expect(create({ appId: otherAppId })).resolves.toMatchObject({
      appId: otherAppId,
    });
  });

  it("rejects empty or unknown categories", async () => {
    await expect(create({ categories: [] })).rejects.toThrow();
    await expect(
      create({ categories: ["Nope" as WebhookCategory] }),
    ).rejects.toThrow();
  });

  it("soft deletes and hides the webhook", async () => {
    const created = await create();

    expect(
      (await service.deleteWebhook(appId, created.id))?.deletedAt,
    ).toBeInstanceOf(Date);
    expect(await service.deleteWebhook(appId, created.id)).toBeUndefined();
    expect(await service.getWebhook(appId, created.id)).toBeUndefined();
    expect((await service.getWebhooks({ appId })).total).toBe(0);
  });

  it("does not let another app read or delete a webhook", async () => {
    const created = await create();

    expect(await service.getWebhook(otherAppId, created.id)).toBeUndefined();
    expect(await service.deleteWebhook(otherAppId, created.id)).toBeUndefined();
    expect(await service.getWebhook(appId, created.id)).toBeDefined();
  });

  it("finds webhooks by category", async () => {
    await create({
      url: "https://a.example/hook",
      categories: [WebhookCategory.Transfer],
    });
    await create({
      url: "https://b.example/hook",
      categories: [WebhookCategory.Deposit, WebhookCategory.Transfer],
    });
    await create({
      url: "https://c.example/hook",
      categories: [WebhookCategory.Recovery],
    });

    const transfer = await service.getWebhooksByCategory(
      appId,
      WebhookCategory.Transfer,
    );
    const recovery = await service.getWebhooksByCategory(
      appId,
      WebhookCategory.Recovery,
    );

    expect(transfer.map((w) => w.url).sort()).toEqual([
      "https://a.example/hook",
      "https://b.example/hook",
    ]);
    expect(recovery.map((w) => w.url)).toEqual(["https://c.example/hook"]);
  });

  describe("deliveries", () => {
    it("records an attempt once per event, webhook and attempt number", async () => {
      const hook = await create();
      const event = await eventFor(appId);
      const startedAt = new Date();

      const first = await service.createWebhookDelivery({
        webhookId: hook.id,
        eventId: event.id,
        attempt: 1,
        startedAt,
      });
      const duplicate = await service.createWebhookDelivery({
        webhookId: hook.id,
        eventId: event.id,
        attempt: 1,
        startedAt,
      });
      const retry = await service.createWebhookDelivery({
        webhookId: hook.id,
        eventId: event.id,
        attempt: 2,
        startedAt,
      });

      expect(first?.id).toBeDefined();
      expect(duplicate).toBeUndefined();
      expect(retry?.id).toBeDefined();
    });

    it("completes a delivery with the response details", async () => {
      const hook = await create();
      const event = await eventFor(appId);
      const delivery = await service.createWebhookDelivery({
        webhookId: hook.id,
        eventId: event.id,
        attempt: 1,
        startedAt: new Date(),
      });

      await service.completeWebhookDelivery(delivery!.id, {
        httpResponseCode: 500,
        error: "HTTP 500",
        completedAt: new Date(),
      });

      const listed = await service.getWebhookDeliveries(appId, hook.id);
      expect(listed?.data).toHaveLength(1);
      expect(listed?.data[0]).toMatchObject({
        httpResponseCode: 500,
        error: "HTTP 500",
      });
    });

    it("lists deliveries only for the owning app", async () => {
      const hook = await create();
      const event = await eventFor(appId);
      await service.createWebhookDelivery({
        webhookId: hook.id,
        eventId: event.id,
        attempt: 1,
        startedAt: new Date(),
      });

      expect(
        await service.getWebhookDeliveries(otherAppId, hook.id),
      ).toBeNull();
      expect((await service.getWebhookDeliveries(appId, hook.id))?.total).toBe(
        1,
      );
    });
  });
});
