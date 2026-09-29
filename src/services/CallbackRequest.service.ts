import { callbackRequest } from "../db/schema";
import { Provider } from "../shared/constants";
import { and, eq } from "drizzle-orm";
import { db } from "../db";

export class CallbackRequestService {
  insertRequest = async (input: (typeof callbackRequest)["$inferInsert"]) => {
    const [created] = await db
      .insert(callbackRequest)
      .values(input)
      .returning();

    return created;
  };

  getRequestById = async (provider: Provider, id: string) => {
    return db.query.callbackRequest.findFirst({
      where: and(
        eq(callbackRequest.id, id),
        eq(callbackRequest.provider, provider),
      ),
    });
  };

  getRequestByProviderId = async (provider: Provider, providerId: string) => {
    return db.query.callbackRequest.findFirst({
      where: and(
        eq(callbackRequest.providerId, providerId),
        eq(callbackRequest.provider, provider),
      ),
    });
  };
}
