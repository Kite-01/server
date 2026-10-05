import { and, eq, isNull, or, gt, desc } from "drizzle-orm";
import { apiKey } from "../db/schema";
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
    await db
      .update(apiKey)
      .set({ lastUsedAt: new Date() })
      .where(
        and(
          eq(apiKey.id, apiKeyId),
          eq(apiKey.appId, appId),
          isNull(apiKey.revokedAt),
          or(isNull(apiKey.expiresAt), gt(apiKey.expiresAt, new Date())),
        ),
      );
  };

  deleteApiKey = async (appId: string, apiKeyId: string) => {
    await db
      .delete(apiKey)
      .where(and(eq(apiKey.id, apiKeyId), eq(apiKey.appId, appId)));
  };

  revokeApiKey = async (appId: string, apiKeyId: string) => {
    await db
      .update(apiKey)
      .set({ revokedAt: new Date() })
      .where(
        and(
          eq(apiKey.id, apiKeyId),
          eq(apiKey.appId, appId),
          isNull(apiKey.revokedAt),
        ),
      );
  };

  getApiKey = async (appId: string, apiKeyId: string) => {
    return db.query.apiKey.findFirst({
      where: and(eq(apiKey.id, apiKeyId), eq(apiKey.appId, appId)),
    });
  };

  getApiKeys = async (appId: string) => {
    return db.query.apiKey.findMany({
      where: eq(apiKey.appId, appId),
      orderBy: desc(apiKey.createdAt),
    });
  };
}
