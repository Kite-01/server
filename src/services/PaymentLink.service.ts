import {
  paginate,
  searchPattern,
  type WithPageInput,
} from "../shared/pagination";
import { PaymentLinkUsage, TransferStatus } from "../shared/constants";
import { and, eq, desc, count, ilike, ne } from "drizzle-orm";
import { paymentLink, quote, transfer } from "../db/schema";
import { PreconditionError } from "../shared/errors";
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
        | "title"
        | "currency"
        | "amount"
        | "lineItems"
        | "usage"
        | "reference"
        | "meta"
        | "returnUrl"
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

  assertPayable = async (
    link: Pick<typeof paymentLink.$inferSelect, "id" | "usage">,
  ) => {
    if (link.usage !== PaymentLinkUsage.OneTime) {
      return;
    }

    const [used] = await db
      .select({ id: transfer.id })
      .from(transfer)
      .innerJoin(quote, eq(quote.id, transfer.quoteId))
      .where(
        and(
          eq(quote.paymentLinkId, link.id),
          ne(transfer.status, TransferStatus.AwaitingDeposit),
        ),
      )
      .limit(1);

    if (used) {
      throw new PreconditionError("Payment link has already been used");
    }
  };

  getPaymentLinks = async (
    input: WithPageInput<{
      appId?: string;
      q?: string;
      reference?: string;
    }>,
  ) => {
    const where = and(
      input.appId ? eq(paymentLink.appId, input.appId) : undefined,
      input.q ? ilike(paymentLink.title, searchPattern(input.q)) : undefined,
      input.reference ? eq(paymentLink.reference, input.reference) : undefined,
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
