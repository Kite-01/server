import { and, eq, desc } from "drizzle-orm";
import { customer } from "../db/schema";
import { omit } from "lodash";
import { db } from "../db";

export class CustomerService {
  upsertCustomer = async (input: typeof customer.$inferInsert) => {
    const [row] = await db
      .insert(customer)
      .values(input)
      .onConflictDoUpdate({
        target: customer.externalId,
        set: { ...omit(input, ["appId"]), updatedAt: new Date() },
      })
      .returning();

    return row;
  };

  getCustomers = async (appId: string) => {
    return await db.query.chain.findMany({
      where: eq(customer.appId, appId),
      orderBy: desc(customer.createdAt),
    });
  };

  getCustomerById = async (appId: string, customerId: string) => {
    return await db.query.customer.findFirst({
      where: and(eq(customer.appId, appId), eq(customer.id, customerId)),
    });
  };

  getCustomerByExternalId = async (appId: string, externalId: string) => {
    return await db.query.customer.findFirst({
      where: and(
        eq(customer.appId, appId),
        eq(customer.externalId, externalId),
      ),
    });
  };

  deleteCustomer = async (appId: string, customerId: string) => {
    await db
      .delete(customer)
      .where(and(eq(customer.appId, appId), eq(customer.id, customerId)));
  };
}
