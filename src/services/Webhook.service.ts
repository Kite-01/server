import { eq, and, desc, arrayContains, exists, isNull, sql } from "drizzle-orm";
import { webhook, webhookDelivery } from "../db/schema";
import { WebhookCategory } from "../shared/constants";
import { common } from "../shared/common";
import { crypt } from "../shared/crypt";
import { db } from "../db";

export class WebhookService {
  createWebhook = async (
    input: Omit<
      typeof webhook.$inferInsert,
      "signingKey" | "signingKeyHint" | "deletedAt"
    >,
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
      where: and(
        eq(webhook.appId, appId),
        eq(webhook.id, webhookId),
        isNull(webhook.deletedAt),
      ),
    });
  };

  getWebhooks = async (appId: string) => {
    return db.query.webhook.findMany({
      where: and(eq(webhook.appId, appId), isNull(webhook.deletedAt)),
      orderBy: desc(webhook.createdAt),
    });
  };

  getWebhooksByCategory = async (appId: string, category: WebhookCategory) => {
    return db.query.webhook.findMany({
      where: and(
        eq(webhook.appId, appId),
        isNull(webhook.deletedAt),
        arrayContains(webhook.categories, [category]),
      ),
      orderBy: desc(webhook.createdAt),
    });
  };

  getWebhookDeliveries = async (appId: string, webhookId: string) => {
    return db
      .select()
      .from(webhookDelivery)
      .where(
        and(
          eq(webhookDelivery.webhookId, webhookId),
          exists(
            db
              .select({ one: sql`1` })
              .from(webhook)
              .where(and(eq(webhook.id, webhookId), eq(webhook.appId, appId))),
          ),
        ),
      )
      .orderBy(desc(webhookDelivery.createdAt));
  };

  deleteWebhook = async (appId: string, webhookId: string) => {
    await db
      .update(webhook)
      .set({ deletedAt: new Date() })
      .where(
        and(
          eq(webhook.appId, appId),
          eq(webhook.id, webhookId),
          isNull(webhook.deletedAt),
        ),
      );
  };

  createWebhookDelivery = async (
    input: typeof webhookDelivery.$inferInsert,
  ) => {
    const [row] = await db
      .insert(webhookDelivery)
      .values(input)
      .onConflictDoNothing()
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
