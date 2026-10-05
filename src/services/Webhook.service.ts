import { eq, and, desc, arrayContains } from "drizzle-orm";
import { webhook, webhookDelivery } from "../db/schema";
import { WebhookCategory } from "../shared/constants";
import { common } from "../shared/common";
import { crypt } from "../shared/crypt";
import { db } from "../db";

export class WebhookService {
  createWebhook = async (
    input: Omit<typeof webhook.$inferInsert, "signingKey" | "signingKeyHint">,
  ) => {
    const { secret, secretHint } = common.generateSecret("whsec_");
    const [row] = await db
      .insert(webhook)
      .values({
        ...input,
        signingKey: crypt.encrypt(secret),
        signingKeyHint: secretHint,
      })
      .returning();

    return { ...row, signingKey: secret };
  };

  getWebhook = async (appId: string, webhookId: string) => {
    return db.query.webhook.findFirst({
      where: and(eq(webhook.appId, appId), eq(webhook.id, webhookId)),
    });
  };

  getWebhooks = async (appId: string) => {
    return db.query.webhook.findMany({
      where: eq(webhook.appId, appId),
      orderBy: desc(webhook.createdAt),
    });
  };

  getWebhooksByCategory = async (appId: string, category: WebhookCategory) => {
    return db.query.webhook.findMany({
      where: and(
        eq(webhook.appId, appId),
        arrayContains(webhook.categories, [category]),
      ),
      orderBy: desc(webhook.createdAt),
    });
  };

  getWebhookDeliveries = async (appId: string, webhookId: string) => {
    return db.query.webhookDelivery.findMany({
      where: eq(webhookDelivery.webhookId, webhookId),
      orderBy: desc(webhookDelivery.createdAt),
    });
  };

  deleteWebhook = async (appId: string, webhookId: string) => {
    await db
      .delete(webhook)
      .where(and(eq(webhook.appId, appId), eq(webhook.id, webhookId)));
  };

  createWebhookDelivery = async (
    input: typeof webhookDelivery.$inferInsert,
  ) => {
    const [row] = await db
      .insert(webhookDelivery)
      .values(input)
      .returning({ id: webhookDelivery.id });

    return row;
  };

  completeWebhookDelivery = async (
    webhookDeliveryId: string,
    input: Partial<typeof webhookDelivery.$inferInsert>,
  ) => {
    await db
      .update(webhookDelivery)
      .set(input)
      .where(eq(webhookDelivery.id, webhookDeliveryId));
  };
}
