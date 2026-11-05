import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db, sql } from "..";
import { quote } from "../schema";
import { parseJsonExact } from "../json";
import { createNearQuoteRow, setupNearChain } from "../../test/near";

const NEAR = 1_800_000_000_000_000_000_000_000n;

describe("parseJsonExact", () => {
  it("parses like JSON.parse when every number fits a double", () => {
    const text =
      '{"a":[1,-2.5,0,1e3,9007199254740991],"b":"x\\"9007199254740993","c":null}';
    expect(parseJsonExact(text)).toEqual(JSON.parse(text));
  });

  it("keeps integers past the safe range as text", () => {
    expect(parseJsonExact(`[${NEAR},-9007199254740993,7]`)).toEqual([
      NEAR.toString(),
      "-9007199254740993",
      7,
    ]);
  });

  it("keeps decimals with more digits than a double holds as text", () => {
    expect(parseJsonExact('{"rate":0.1234567890123456789,"usd":4.50}')).toEqual(
      {
        rate: "0.1234567890123456789",
        usd: 4.5,
      },
    );
  });

  it("leaves digits inside strings alone", () => {
    expect(parseJsonExact('["1800000000000000000000000","a\\\\",2]')).toEqual([
      "1800000000000000000000000",
      "a\\",
      2,
    ]);
  });
});

describe("json from postgres", () => {
  it("returns numerics in json exactly", async () => {
    const [row] =
      await sql`select json_build_array(${NEAR.toString()}::numeric) as v`;
    expect(row.v).toEqual([NEAR.toString()]);
  });

  it("keeps jsonb on the default parser", async () => {
    const [row] = await sql`select '{"a":1}'::jsonb as v`;
    expect(row.v).toEqual({ a: 1 });
  });

  it("keeps a 24-decimal amount exact on a related row", async () => {
    const { appId, chainId, nearId, usdcId } = await setupNearChain();
    const created = await createNearQuoteRow({
      appId,
      chainId,
      sourceTokenId: nearId,
      targetTokenId: usdcId,
      sourceAmount: NEAR,
      targetAmount: 4_500_000n,
    });

    const top = await db.query.quote.findFirst({
      where: eq(quote.id, created.id),
    });
    const nested = await db.query.chain.findFirst({ with: { quotes: true } });

    expect(top?.sourceAmount).toBe(NEAR);
    expect(nested?.quotes[0].sourceAmount).toBe(NEAR);
    expect(nested?.quotes[0].targetAmount).toBe(4_500_000n);
  });
});
