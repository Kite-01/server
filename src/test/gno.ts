import { db } from "../db";
import { appChain, chain, chainConfig, quote, token } from "../db/schema";
import { kiteGno } from "../shared/kiteGnoContract";
import { createApp } from "./factories";
import { fakeGnoActor } from "./mocks";
import { env } from "../shared/env";

export const GNO_CAIP2 = "gno:onyx-1" as Caip2Id;
export const GNO_NS = "g1dd5hgetyv4m97h6lta047h6lta047h6lcxye47";
export const GNO_REALM = `gno.land/r/${GNO_NS}/kite`;
export const GNO_KUSD = `gno.land/r/${GNO_NS}/kusd.KUSD`;
export const GNO_SHOP = "g1d4jhycmgv9h8gh6lta047h6lta047h6lsu9czk";
export const GNO_PAYER = "g1vd6hxar0d4jhyh6lta047h6lta047h6lws58ht";

export const setupGnoChain = async () => {
  env.KITE_IS_TESTNET = true;

  const appId = (await createApp()).id;
  const [row] = await db
    .insert(chain)
    .values({ caip2Id: GNO_CAIP2 })
    .returning();
  const chainId = row.id;

  const [gnot, kusd] = await db
    .insert(token)
    .values(
      [
        { address: "ugnot", symbol: "GNOT", name: "GNOT" },
        { address: GNO_KUSD, symbol: "KUSD", name: "Kite USD" },
      ].map((item) => ({ ...item, chainId, decimals: 6, listed: true })),
    )
    .returning();

  await db.insert(chainConfig).values({
    chainId,
    slippageBps: 100,
    kiteFactoryAddress: GNO_REALM,
    usdPeggedTokenId: kusd.id,
    settlementTokenId: gnot.id,
    onchainNotifierProviders: [],
    gasSponsorProviders: [],
  });

  await db.insert(appChain).values({ appId, chainId, address: GNO_SHOP });

  fakeGnoActor.evaluate.mockImplementation(async (...args: unknown[]) => {
    const [, pkg, expr] = args as [Caip2Id, string, string];
    const deposit = /^DepositAddress\((".*")\)$/.exec(expr);
    if (pkg === GNO_REALM && deposit) {
      return kiteGno.predictAddress(GNO_REALM, decode(JSON.parse(deposit[1])));
    }
    if (pkg === GNO_REALM && expr.startsWith("StatusOf(")) return "Open";
    throw new Error(`unexpected evaluate ${pkg}.${expr}`);
  });

  return { appId, chainId, gnotId: gnot.id, kusdId: kusd.id };
};

const decode = (encoded: string) => {
  const fields = Object.fromEntries(
    encoded
      .split(";")
      .slice(1)
      .map((part) => [
        part.slice(0, part.indexOf("=")),
        part.slice(part.indexOf("=") + 1),
      ]),
  );
  return {
    id: fields.id,
    token: fields.token,
    amount: fields.amount,
    recipient: fields.recipient,
    fees: fields.fees
      ? fields.fees.split(",").map((fee: string) => {
          const [recipient, amount] = fee.split(":");
          return { recipient, amount };
        })
      : [],
    refund: fields.refund,
    expires_at: fields.expires,
  };
};

export const createGnoQuoteRow = async (input: {
  appId: string;
  chainId: string;
  sourceTokenId: string;
  targetTokenId: string;
  sourceAmount?: bigint;
}) => {
  const [row] = await db
    .insert(quote)
    .values({
      appId: input.appId,
      chainId: input.chainId,
      sourceTokenId: input.sourceTokenId,
      targetTokenId: input.targetTokenId,
      sourceAmount: input.sourceAmount ?? 10_000_000n,
      targetAmount: input.sourceAmount ?? 10_000_000n,
      sourceUsdAmount: "1",
      targetUsdAmount: "1",
      rate: "1",
      expiresAt: new Date(Date.now() + 5 * 60 * 1000),
    })
    .returning();

  return row;
};

export const gnoEvent = (type: string, attrs: Record<string, string>) => ({
  type,
  pkg_path: GNO_REALM,
  attrs: Object.entries(attrs).map(([key, value]) => ({ key, value })),
});

export const gnoResult = (events: ReturnType<typeof gnoEvent>[] = []) => ({
  transactionHash: "GnoTxHash=",
  events,
});
