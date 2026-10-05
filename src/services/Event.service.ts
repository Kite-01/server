import { type WebhookCategory } from "../shared/constants";
import { eq, and, desc } from "drizzle-orm";
import { event } from "../db/schema";
import { db } from "../db";

export class EventService {
  createEvent = async (input: typeof event.$inferInsert) => {
    const [row] = await db.insert(event).values(input).returning();
    return row;
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
