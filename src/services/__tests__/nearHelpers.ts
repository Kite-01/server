import { db } from "../../db";
import { quote } from "../../db/schema";

export { createApp } from "../../test/factories";

export const createQuoteRowFor = async (input: {
  appId: string;
  chainId: string;
  sourceTokenId: string;
  targetTokenId: string;
  sourceAmount?: bigint;
  targetAmount?: bigint;
}) => {
  const [row] = await db
    .insert(quote)
    .values({
      appId: input.appId,
      chainId: input.chainId,
      sourceTokenId: input.sourceTokenId,
      targetTokenId: input.targetTokenId,
      sourceAmount: input.sourceAmount ?? 1_000_000n,
      targetAmount: input.targetAmount ?? input.sourceAmount ?? 1_000_000n,
      sourceUsdAmount: "1",
      targetUsdAmount: "1",
      rate: "1",
      expiresAt: new Date(Date.now() + 5 * 60 * 1000),
    })
    .returning();

  return row;
};
