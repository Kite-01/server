import {
  paginate,
  searchPattern,
  type WithPageInput,
} from "../shared/pagination";
import { and, eq, isNull, or, gt, lt, desc, count, ilike } from "drizzle-orm";
import { apiKey, apiNonce } from "../db/schema";
import { OneMinute } from "../shared/constants";
import { common } from "../shared/common";
import { db } from "../db";

export class ApiKeyService {
  createApiKey = async (input: typeof apiKey.$inferInsert) => {
    const [row] = await db.insert(apiKey).values(input).returning();
    return row;
  };

  updateApiKey = async (
    appId: string,
    apiKeyId: string,
    update: Partial<
      Pick<typeof apiKey.$inferInsert, "label" | "scopes" | "allowedOrigins">
    >,
  ) => {
    const [row] = await db
      .update(apiKey)
      .set(update)
      .where(and(eq(apiKey.id, apiKeyId), eq(apiKey.appId, appId)))
      .returning();

    return row;
  };

  updateApiKeyLastUsed = async (appId: string, apiKeyId: string) => {
    const staleBefore = new Date(Date.now() - common.toMs(OneMinute));

    await db
      .update(apiKey)
      .set({ lastUsedAt: new Date() })
      .where(
        and(
          eq(apiKey.id, apiKeyId),
          eq(apiKey.appId, appId),
          isNull(apiKey.revokedAt),
          or(isNull(apiKey.expiresAt), gt(apiKey.expiresAt, new Date())),
          or(isNull(apiKey.lastUsedAt), lt(apiKey.lastUsedAt, staleBefore)),
        ),
      );
  };

  deleteApiKey = async (appId: string, apiKeyId: string) => {
    const [row] = await db
      .delete(apiKey)
      .where(and(eq(apiKey.id, apiKeyId), eq(apiKey.appId, appId)))
      .returning();

    return row;
  };

  revokeApiKey = async (appId: string, apiKeyId: string) => {
    const [row] = await db
      .update(apiKey)
      .set({ revokedAt: new Date() })
      .where(
        and(
          eq(apiKey.id, apiKeyId),
          eq(apiKey.appId, appId),
          isNull(apiKey.revokedAt),
        ),
      )
      .returning();

    return row ?? this.getApiKey(appId, apiKeyId);
  };

  getApiKey = async (appId: string, apiKeyId: string) => {
    return db.query.apiKey.findFirst({
      where: and(eq(apiKey.id, apiKeyId), eq(apiKey.appId, appId)),
    });
  };

  getApiKeyWithApp = async (apiKeyId: string) => {
    return db.query.apiKey.findFirst({
      where: eq(apiKey.id, apiKeyId),
      with: { app: true },
    });
  };

  getApiKeys = async (
    input: WithPageInput<{
      appId?: string;
      q?: string;
    }>,
  ) => {
    const where = and(
      input.appId ? eq(apiKey.appId, input.appId) : undefined,
      input.q ? ilike(apiKey.label, searchPattern(input.q)) : undefined,
    );

    return paginate(
      input,
      (limit, offset) => {
        return db.query.apiKey.findMany({
          where,
          orderBy: desc(apiKey.createdAt),
          limit,
          offset,
        });
      },
      async () => {
        const [row] = await db
          .select({ value: count() })
          .from(apiKey)
          .where(where);
        return row.value;
      },
    );
  };

  consumeNonce = async (keyId: string, nonce: string) => {
    const rows = await db
      .insert(apiNonce)
      .values({ keyId, nonce })
      .onConflictDoNothing()
      .returning({ nonce: apiNonce.nonce });

    return rows.length === 1;
  };

  pruneNonces = async (olderThan: Date) => {
    await db.delete(apiNonce).where(lt(apiNonce.createdAt, olderThan));
  };
}
