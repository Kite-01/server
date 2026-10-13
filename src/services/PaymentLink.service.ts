import {
  paginate,
  searchPattern,
  type WithPageInput,
} from "../shared/pagination";
import { and, eq, desc, count, ilike } from "drizzle-orm";
import { paymentLink } from "../db/schema";
import { db } from "../db";

export class PaymentLinkService {
  createPaymentLink = async (input: typeof paymentLink.$inferInsert) => {
    const [row] = await db.insert(paymentLink).values(input).returning();
    return row;
  };

  updatePaymentLink = async (
    appId: string,
    paymentLinkId: string,
    update: Partial<
      Pick<
        typeof paymentLink.$inferInsert,
        "title" | "currency" | "amount" | "lineItems"
      >
    >,
  ) => {
    const [row] = await db
      .update(paymentLink)
      .set(update)
      .where(
        and(eq(paymentLink.appId, appId), eq(paymentLink.id, paymentLinkId)),
      )
      .returning();

    return row;
  };

  getPaymentLinks = async (
    input: WithPageInput<{
      appId?: string;
      q?: string;
    }>,
  ) => {
    const where = and(
      input.appId ? eq(paymentLink.appId, input.appId) : undefined,
      input.q ? ilike(paymentLink.title, searchPattern(input.q)) : undefined,
    );

    return paginate(
      input,
      (limit, offset) => {
        return db.query.paymentLink.findMany({
          where,
          orderBy: desc(paymentLink.createdAt),
          limit,
          offset,
        });
      },
      async () => {
        const [row] = await db
          .select({ value: count() })
          .from(paymentLink)
          .where(where);

        return row.value;
      },
    );
  };

  getPaymentLink = async (appId: string, paymentLinkId: string) => {
    return db.query.paymentLink.findFirst({
      where: and(
        eq(paymentLink.appId, appId),
        eq(paymentLink.id, paymentLinkId),
      ),
    });
  };

  deletePaymentLink = async (appId: string, paymentLinkId: string) => {
    const [row] = await db
      .delete(paymentLink)
      .where(
        and(eq(paymentLink.appId, appId), eq(paymentLink.id, paymentLinkId)),
      )
      .returning();

    return row;
  };
}
