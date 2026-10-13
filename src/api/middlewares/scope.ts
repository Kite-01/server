import {
  apiKey,
  customer,
  paymentLink,
  quote,
  transfer,
  webhook,
} from "../../db/schema";
import { type Actor } from "./auth";
import { HttpError } from "../../shared/errors";
import { eq } from "drizzle-orm";
import { db } from "../../db";

const tables = {
  apiKey,
  customer,
  paymentLink,
  quote,
  transfer,
  webhook,
};

export class Scope {
  static appFor = async (
    actor: Actor,
    resource: keyof typeof tables,
    id: string,
  ) => {
    if (actor.appId) {
      return actor.appId;
    }

    const table = tables[resource] as typeof apiKey;
    const [row] = await db
      .select({ appId: table.appId })
      .from(table)
      .where(eq(table.id, id))
      .limit(1);

    if (!row) {
      throw new HttpError(404, "NotFound", resource);
    }

    return row.appId;
  };
}
