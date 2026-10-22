import {
  eq,
  and,
  desc,
  arrayContains,
  isNull,
  count,
  ilike,
  or,
} from "drizzle-orm";
import {
  paginate,
  searchPattern,
  type WithPageInput,
  type PageInput,
} from "../shared/pagination";
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

  getWebhooks = async (
    input: WithPageInput<{
      appId?: string;
      q?: string;
    }>,
  ) => {
    const pattern = input.q ? searchPattern(input.q) : undefined;
    const where = and(
      pattern
        ? or(ilike(webhook.label, pattern), ilike(webhook.url, pattern))
        : undefined,
      input.appId ? eq(webhook.appId, input.appId) : undefined,
      isNull(webhook.deletedAt),
    );

    return paginate(
      input,
      (limit, offset) => {
        return db.query.webhook.findMany({
          where,
          orderBy: desc(webhook.createdAt),
          limit,
          offset,
        });
      },
      async () => {
        const [row] = await db
          .select({ value: count() })
          .from(webhook)
          .where(where);

        return row.value;
      },
    );
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

  getWebhookDeliveries = async (
    appId: string,
    webhookId: string,
    input: PageInput = {},
  ) => {
    const webhook_ = await this.getWebhook(appId, webhookId);
    if (!webhook_) {
      return null;
    }

    const where = eq(webhookDelivery.webhookId, webhookId);

    return paginate(
      input,
      (limit, offset) => {
        return db
          .select()
          .from(webhookDelivery)
          .where(where)
          .limit(limit)
          .offset(offset)
          .orderBy(desc(webhookDelivery.createdAt));
      },
      async () => {
        const [row] = await db
          .select({ value: count() })
          .from(webhookDelivery)
          .where(where);

        return row.value;
      },
    );
  };

  deleteWebhook = async (appId: string, webhookId: string) => {
    const [row] = await db
      .update(webhook)
      .set({ deletedAt: new Date() })
      .where(
        and(
          eq(webhook.appId, appId),
          eq(webhook.id, webhookId),
          isNull(webhook.deletedAt),
        ),
      )
      .returning();

    return row;
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
