import { and, eq, desc } from "drizzle-orm";
import { paymentLink } from "../db/schema";
import { db } from "../db";

export class PaymentLinkService {
  createPaymentLink = async (input: typeof paymentLink.$inferInsert) => {
    const [row] = await db.insert(paymentLink).values(input).returning();
    return row;
  };

  getPaymentLinks = async (appId: string) => {
    return db.query.paymentLink.findMany({
      where: eq(paymentLink.appId, appId),
      orderBy: desc(paymentLink.createdAt),
    });
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
    await db
      .delete(paymentLink)
      .where(
        and(eq(paymentLink.appId, appId), eq(paymentLink.id, paymentLinkId)),
      );
  };
}
