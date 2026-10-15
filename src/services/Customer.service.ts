import {
  paginate,
  searchPattern,
  type WithPageInput,
} from "../shared/pagination";
import { and, eq, desc, count, ilike, or } from "drizzle-orm";
import { PreconditionError } from "../shared/errors";
import { customer, quote } from "../db/schema";
import { omit } from "lodash";
import { db } from "../db";

export class CustomerService {
  upsertCustomer = async (input: typeof customer.$inferInsert) => {
    const [row] = await db
      .insert(customer)
      .values(input)
      .onConflictDoUpdate({
        target: [customer.appId, customer.externalId],
        set: { ...omit(input, ["appId"]), updatedAt: new Date() },
      })
      .returning();

    return row;
  };

  getCustomers = async (
    input: WithPageInput<{
      appId?: string;
      externalId?: string;
      q?: string;
    }>,
  ) => {
    const pattern = input.q ? searchPattern(input.q) : undefined;
    const where = and(
      input.appId ? eq(customer.appId, input.appId) : undefined,
      input.externalId ? eq(customer.externalId, input.externalId) : undefined,
      pattern
        ? or(ilike(customer.name, pattern), ilike(customer.externalId, pattern))
        : undefined,
    );

    return paginate(
      input,
      (limit, offset) => {
        return db.query.customer.findMany({
          where,
          orderBy: desc(customer.createdAt),
          limit,
          offset,
        });
      },
      async () => {
        const [row] = await db
          .select({ value: count() })
          .from(customer)
          .where(where);

        return row.value;
      },
    );
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
    const [quotes] = await db
      .select({ count: count() })
      .from(quote)
      .where(and(eq(quote.appId, appId), eq(quote.customerId, customerId)));

    if (quotes.count > 0)
      throw new PreconditionError("Customers with quotes cannot be deleted");

    const [row] = await db
      .delete(customer)
      .where(and(eq(customer.appId, appId), eq(customer.id, customerId)))
      .returning();

    return row;
  };
}
