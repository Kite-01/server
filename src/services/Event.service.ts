import { type WebhookCategory } from "../shared/constants";
import { db, dbWithTransaction } from "../db";
import { eq, and, desc } from "drizzle-orm";
import { Scheduler } from "../shared/scheduler";
import { event } from "../db/schema";

export class EventService {
  createEvent = async (input: typeof event.$inferInsert) => {
    return db.transaction(async (transaction) => {
      const [row] = await transaction.insert(event).values(input).returning();

      await Scheduler.enqueueEvent(
        row.appId,
        row.id,
        dbWithTransaction(transaction),
      );

      return row;
    });
  };

  getEvent = async (appId: string, eventId: string) => {
    return await db.query.event.findFirst({
      where: and(eq(event.appId, appId), eq(event.id, eventId)),
      with: {
        deliveries: {
          with: {
            webhook: true,
          },
        },
      },
    });
  };

  getEvents = async (appId: string, category?: WebhookCategory) => {
    const where = category
      ? and(eq(event.appId, appId), eq(event.category, category))
      : eq(event.appId, appId);

    return await db.query.event.findMany({
      where,
      orderBy: desc(event.createdAt),
      with: {
        deliveries: {
          with: {
            webhook: true,
          },
        },
      },
    });
  };
}
