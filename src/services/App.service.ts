import {
  paginate,
  searchPattern,
  type WithPageInput,
} from "../shared/pagination";
import { and, eq, isNull, desc, count, ilike } from "drizzle-orm";
import { app } from "../db/schema";
import { db } from "../db";

export class AppService {
  createApp = async (input: typeof app.$inferInsert) => {
    const [row] = await db.insert(app).values(input).returning();
    return row;
  };

  updateApp = async (
    appId: string,
    update: Partial<
      Pick<
        typeof app.$inferInsert,
        | "name"
        | "icon"
        | "websiteUrl"
        | "termsOfServiceUrl"
        | "privacyPolicyUrl"
      >
    >,
  ) => {
    const [row] = await db
      .update(app)
      .set(update)
      .where(and(eq(app.id, appId), isNull(app.deletedAt)))
      .returning();

    return row;
  };

  deleteApp = async (appId: string) => {
    const [row] = await db
      .update(app)
      .set({ deletedAt: new Date() })
      .where(and(eq(app.id, appId), isNull(app.deletedAt)))
      .returning();

    return row;
  };

  doesAppExist = async (appId: string) => {
    const result = await db
      .select({ count: count() })
      .from(app)
      .where(eq(app.id, appId));

    return result[0].count > 0;
  };

  getApp = async (appId: string) => {
    return db.query.app.findFirst({
      where: and(eq(app.id, appId), isNull(app.deletedAt)),
    });
  };

  getApps = async (
    input: WithPageInput<{
      q?: string;
    }>,
  ) => {
    const where = and(
      isNull(app.deletedAt),
      input.q ? ilike(app.name, searchPattern(input.q)) : undefined,
    );

    return paginate(
      input,
      (limit, offset) => {
        return db.query.app.findMany({
          where,
          orderBy: desc(app.createdAt),
          limit,
          offset,
        });
      },
      async () => {
        const [row] = await db
          .select({ value: count() })
          .from(app)
          .where(where);
        return row.value;
      },
    );
  };
}
