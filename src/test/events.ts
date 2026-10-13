import { WebhookCategory } from "../shared/constants";
import { event } from "../db/schema";
import { db } from "../db";

export const eventFor = async (
  appId: string,
  values: Partial<typeof event.$inferInsert> = {},
) => {
  const [row] = await db
    .insert(event)
    .values({
      appId,
      category: WebhookCategory.Transfer,
      currentCategoryStatus: "Settled",
      data: {},
      ...values,
    })
    .returning();

  return row;
};
