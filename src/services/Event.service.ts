import { paginate, type WithPageInput } from "../shared/pagination";
import { db, dbWithTransaction } from "../db";
import { type WebhookCategory } from "../shared/constants";
import { eq, and, desc, count } from "drizzle-orm";
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

  getEvents = async (
    input: WithPageInput<{
      category?: WebhookCategory;
      appId?: string;
    }>,
  ) => {
    const where = and(
      input.appId ? eq(event.appId, input.appId) : undefined,
      input.category ? eq(event.category, input.category) : undefined,
    );

    return paginate(
      input,
      (limit, offset) => {
        return db.query.event.findMany({
          where,
          orderBy: desc(event.createdAt),
          limit,
          offset,
        });
      },
      async () => {
        const [row] = await db
          .select({ value: count() })
          .from(event)
          .where(where);

        return row.value;
      },
    );
  };
}
