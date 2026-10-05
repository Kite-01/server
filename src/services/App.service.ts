import { and, eq, isNull, desc } from "drizzle-orm";
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
    await db
      .update(app)
      .set({ deletedAt: new Date() })
      .where(and(eq(app.id, appId), isNull(app.deletedAt)));
  };

  getApp = async (appId: string) => {
    return db.query.app.findFirst({
      where: and(eq(app.id, appId), isNull(app.deletedAt)),
    });
  };

  getApps = async () => {
    return db.query.app.findMany({
      where: isNull(app.deletedAt),
      orderBy: desc(app.createdAt),
    });
  };
}
