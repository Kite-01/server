import {
  chain,
  chainConfig,
  chainAllowToken,
  chainDenyToken,
} from "../db/schema";
import { and, eq } from "drizzle-orm";
import { db } from "../db";

export class ChainService {
  getChain = async (caip2Id: Caip2Id) => {
    return db.query.chain.findFirst({
      where: eq(chain.caip2Id, caip2Id),
    });
  };
}
