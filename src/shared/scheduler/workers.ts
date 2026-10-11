import { OperatorForwardService } from "../../services/OperatorForward.service";
import { TransferService } from "../../services/Transfer.service";
import { WebhookService } from "../../services/Webhook.service";
import { SafeHttpClient } from "../safeHttpClient";
import { EventService } from "../../services/Event.service";
import { type PgBoss } from "pg-boss";
import { createHmac } from "node:crypto";
import { version } from "../../../package.json";
import { common } from "../common";
import { crypt } from "../crypt";
import { Queue } from "../constants";

export const startWorkers = async (boss: PgBoss) => {
  const httpClient = new SafeHttpClient();
  const eventService = new EventService();
  const webhookService = new WebhookService();
  const transferService = new TransferService();
  const operatorForwardService = new OperatorForwardService();

  await boss.work(Queue.EventFanout, { localConcurrency: 5 }, async ([job]) => {
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

    await boss.insert(
      Queue.WebhookDelivery,
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
  });

  await boss.work(
    Queue.WebhookDelivery,
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

      if (!webhook || !event) return result("completed");

      const delivery = await webhookService.createWebhookDelivery({
        eventId,
        webhookId,
        attempt,
        startedAt: new Date(),
      });

      if (!delivery) return result("completed");

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

      const body = JSON.stringify(payload);
      const timestamp = Math.floor(Date.now() / 1000);
      const signingKey = crypt.decrypt(webhook.signingKey);
      const signature = createHmac("sha256", signingKey)
        .update(`t=${timestamp}&${body}`)
        .digest("hex");

      let ok: boolean = false,
        httpResponseCode: Maybe<number>,
        httpResponseHeaders: Maybe<Record<string, string>>,
        httpResponseBody: Maybe<string>,
        error: Maybe<string>;

      try {
        const response = await httpClient.makeRequest(webhook.url, {
          method: "POST",
          body,
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
        httpResponseHeaders = Object.fromEntries(response.headers);
        httpResponseCode = response.status;
        httpResponseBody = await httpClient.readText(response, 64 * 1024);

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

      if (ok) return result("completed");

      return result(willRetry ? "failed" : "deadletter", {
        reason: error,
      });
    },
  );

  await boss.work<{ transferId: string }>(
    Queue.SettleTransfer,
    { localConcurrency: 5 },
    async ([job]) => transferService.settleTransfer(job.data.transferId),
  );

  await boss.work<{ transferId: string }>(
    Queue.RefundTransfer,
    { localConcurrency: 5 },
    async ([job]) => transferService.refundTransfer(job.data.transferId),
  );

  await boss.work<{ transferId: string; tokenAddress: string }>(
    Queue.RecoverTransfer,
    { localConcurrency: 5 },
    async ([job]) =>
      transferService.recoverTransferToken(
        job.data.transferId,
        job.data.tokenAddress,
      ),
  );

  await boss.work<{ forwardId: string }>(
    Queue.OperatorForward,
    { localConcurrency: 5 },
    async ([job]) => operatorForwardService.processForward(job.data.forwardId),
  );

  await boss.work(Queue.TransferSweep, async () => transferService.sweep());

  return async () => {
    await httpClient.close();
  };
};
