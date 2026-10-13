import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { WebhookCategory } from "../../constants";
import { webhookDelivery } from "../../../db/schema";
import { WebhookService } from "../../../services/Webhook.service";
import { ApiKeyService } from "../../../services/ApiKey.service";
import { EventService } from "../../../services/Event.service";
import { createHmac } from "node:crypto";
import { createApp } from "../../../test/factories";
import { Scheduler } from "..";
import { db } from "../../../db";

vi.unmock("../../scheduler");

const deliveries = vi.hoisted(() => ({
  requests: [] as Array<{
    url: string;
    headers: Record<string, string>;
    body: string;
  }>,
  statuses: [] as number[],
}));

vi.mock("../../safeHttpClient", () => ({
  SafeHttpClient: class {
    makeRequest = async (
      url: string,
      init: {
        headers: Record<string, string>;
        body: string;
      },
    ) => {
      deliveries.requests.push({
        url,
        headers: init.headers,
        body: init.body,
      });

      return new Response("ok", {
        status: deliveries.statuses.shift() ?? 200,
      });
    };
    readText = async (response: Response) => response.text();
    close = async () => {};
  },
}));

describe("scheduler", () => {
  beforeAll(async () => {
    await Scheduler.start();
  });

  afterAll(async () => {
    await (await Scheduler.getInstance()).stop();
  });

  beforeEach(() => {
    deliveries.requests.length = 0;
    deliveries.statuses.length = 0;
  });

  it("delivers a signed webhook for a new event", async () => {
    const app = await createApp();
    const webhook = await new WebhookService().createWebhook({
      appId: app.id,
      url: "https://test.app/cb",
      label: "main",
      categories: [WebhookCategory.Transfer],
    });

    const event = await new EventService().createEvent({
      appId: app.id,
      category: WebhookCategory.Transfer,
      previousCategoryStatus: "AwaitingDeposit",
      currentCategoryStatus: "Settled",
      data: {
        id: "transfer-1",
      },
    });

    await vi.waitFor(() => expect(deliveries.requests).toHaveLength(1), {
      timeout: 15_000,
    });

    const [request] = deliveries.requests;
    expect(request.url).toBe("https://test.app/cb");

    const payload = JSON.parse(request.body);

    expect(payload).toMatchObject({
      eventId: event.id,
      webhookId: webhook.id,
      category: WebhookCategory.Transfer,
      previous: {
        status: "AwaitingDeposit",
      },
      current: {
        status: "Settled",
      },
      data: {
        id: "transfer-1",
      },
    });

    const expected = createHmac("sha256", webhook.signingKey)
      .update(`t=${request.headers["X-Kite-Timestamp"]}&${request.body}`)
      .digest("hex");

    expect(request.headers["X-Kite-Signature"]).toBe(expected);
    expect(request.headers["X-Kite-Event-Id"]).toBe(event.id);

    await vi.waitFor(async () => {
      const rows = await db.select().from(webhookDelivery);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ attempt: 1, httpResponseCode: 200 });
      expect(rows[0].completedAt).toBeInstanceOf(Date);
    });
  });

  it("retries a failed delivery up to the webhook's limit", async () => {
    const app = await createApp();

    await new WebhookService().createWebhook({
      appId: app.id,
      url: "https://test.app/flaky",
      label: "flaky",
      categories: [WebhookCategory.Deposit],
      maxRetries: 1,
      retryIntervalInSeconds: 1,
    });

    deliveries.statuses.push(500);

    await new EventService().createEvent({
      appId: app.id,
      category: WebhookCategory.Deposit,
      currentCategoryStatus: "Completed",
      data: {},
    });

    await vi.waitFor(() => expect(deliveries.requests).toHaveLength(2), {
      timeout: 20_000,
    });

    await vi.waitFor(async () => {
      const rows = await db.select().from(webhookDelivery);
      const byAttempt = Object.fromEntries(
        rows.map((row) => [row.attempt, row.httpResponseCode]),
      );

      expect(byAttempt).toEqual({ 1: 500, 2: 200 });
    });
  });

  it("only delivers events to webhooks subscribed to their category", async () => {
    const app = await createApp();

    await new WebhookService().createWebhook({
      appId: app.id,
      url: "https://test.app/recovery-only",
      label: "recovery",
      categories: [WebhookCategory.Recovery],
    });

    await new EventService().createEvent({
      appId: app.id,
      category: WebhookCategory.Transfer,
      currentCategoryStatus: "Settled",
      data: {},
    });

    await new Promise((resolve) => setTimeout(resolve, 1500));
    expect(deliveries.requests).toHaveLength(0);
  });

  it("registers the nonce cleanup job", async () => {
    const scheduler = await Scheduler.getInstance();
    const schedules = await scheduler.boss.getSchedules();

    expect(schedules.map((s) => s.name)).toEqual(
      expect.arrayContaining(["TransferSweep", "ApiNonceCleanup"]),
    );

    const res = new ApiKeyService().pruneNonces(new Date());
    await expect(res).resolves.toBeUndefined();
  });
});
