import { WebhookService } from "../../services/Webhook.service";
import { SafeHttpClient } from "../safeHttpClient";
import { EventService } from "../../services/Event.service";
import { createHmac } from "node:crypto";
import { version } from "../../../package.json";
import { OneHour } from "../constants";
import { PgBoss } from "pg-boss";
import { common } from "../common";
import { crypt } from "../crypt";
import { env } from "../env";

export const Queues = {
  fanout: "event-fanout",
  delivery: "webhook-delivery",
  deliveryDlq: "webhook-delivery-dlq",
};

class Workers {
  constructor(
    private readonly boss: PgBoss,
    private workersStarted = false,
  ) {}

  start = async () => {
    if (this.workersStarted) {
      return;
    }

    this.workersStarted = true;

    const eventService = new EventService();
    const webhookService = new WebhookService();

    await this.boss.work(
      Queues.fanout,
      { localConcurrency: 5 },
      async ([job]) => {
        const { appId, eventId } = job.data as {
          appId: string;
          eventId: string;
        };

        const event = await eventService.getEvent(appId, eventId);
        if (!event) {
          return;
        }

        const webhooks = await webhookService.getWebhooksByCategory(
          appId,
          event.category,
        );

        if (webhooks.length === 0) {
          return;
        }

        await this.boss.insert(
          Queues.delivery,
          webhooks.map((webhook) => ({
            data: {
              appId,
              eventId,
              webhookId: webhook.id,
            },
            retryBackoff: false,
            retryLimit: webhook.maxRetries,
            retryDelay: webhook.retryIntervalInSeconds,
          })),
        );
      },
    );

    await this.boss.work(
      Queues.delivery,
      { perJobResults: true, includeMetadata: true, localConcurrency: 50 },
      async ([job]) => {
        const result = (
          status: "completed" | "failed" | "deadletter",
          output?: object,
        ) => [{ id: job.id, status, output }];

        const { appId, eventId, webhookId } = job.data as {
          appId: string;
          eventId: string;
          webhookId: string;
        };

        const attempt = job.retryCount + 1;
        const canRetry = job.retryCount < job.retryLimit;

        const [webhook, event] = await Promise.all([
          webhookService.getWebhook(appId, webhookId),
          eventService.getEvent(appId, eventId),
        ]);

        if (!webhook || !event) {
          return result("failed");
        }

        const delivery = await webhookService.createWebhookDelivery({
          eventId,
          webhookId,
          attempt,
          startedAt: new Date(),
        });

        const payload = {
          id: delivery.id,
          eventId: event.id,
          webhookId: webhook.id,
          category: event.category,
          previous: {
            status: event.previousCategoryStatus,
          },
          current: {
            status: event.currentCategoryStatus,
          },
          data: event.data,
        };

        const timestamp = Math.floor(Date.now() / 1000);
        const signingKey = crypt.decrypt(webhook.signingKey);
        const signature = createHmac("sha256", signingKey)
          .update(`t=${timestamp}&${JSON.stringify(payload)}`)
          .digest("hex");

        let ok: boolean = false,
          httpResponseCode: Maybe<number>,
          httpResponseHeaders: Maybe<Record<string, string>>,
          httpResponseBody: Maybe<string>,
          error: Maybe<string>;

        try {
          const response = await new SafeHttpClient().makeRequest(webhook.url, {
            body: JSON.stringify(payload),
            signal: AbortSignal.timeout(common.toMs(webhook.timeoutInSeconds)),
            headers: {
              "Content-Type": "application/json",
              "User-Agent": `kite/${version}`,
              "X-Kite-Timestamp": String(timestamp),
              "X-Kite-Signature": signature,
              "X-Kite-Event-Id": event.id,
            },
          });

          ok = response.ok;
          httpResponseBody = await response.text();
          httpResponseHeaders = Object.fromEntries(response.headers);
          httpResponseCode = response.status;
          if (!ok) error = `HTTP ${httpResponseCode}`;
        } catch (e) {
          error = (e as Error).message;
        }

        const willRetry = !ok && canRetry && httpResponseCode !== 410;

        await webhookService.completeWebhookDelivery(delivery.id, {
          httpResponseCode,
          httpResponseHeaders,
          httpResponseBody,
          error,
          completedAt: new Date(),
          nextRetryAt: willRetry
            ? new Date(Date.now() + common.toMs(job.retryDelay))
            : null,
        });

        if (ok) {
          return result("completed");
        }

        return result(willRetry ? "failed" : "deadletter", {
          reason: error,
        });
      },
    );
  };
}

export class Scheduler {
  private static instance: Promise<Scheduler> | null = null;

  constructor(
    public readonly boss: PgBoss,
    public readonly workers: Workers,
  ) {}

  static getInstance = async () => {
    Scheduler.instance ??= Scheduler.connect().catch((e) => {
      Scheduler.instance = null;
      throw e;
    });

    return Scheduler.instance;
  };

  private static connect = async () => {
    const boss = new PgBoss({
      connectionString: env.KITE_PG_DB_URL,
      useListenNotify: true,
      max: 20,
    });

    boss.on("error", console.error);
    boss.on("warning", console.warn);

    await boss.start();
    await boss.createQueue(Queues.fanout);
    await boss.createQueue(Queues.fanout);
    await boss.createQueue(Queues.deliveryDlq);
    await boss.createQueue(Queues.delivery, {
      partition: true,
      notify: true,
      deleteAfterSeconds: OneHour,
      deadLetter: Queues.deliveryDlq,
    });

    return new Scheduler(boss, new Workers(boss));
  };

  stop = async () => this.boss.stop();
}
