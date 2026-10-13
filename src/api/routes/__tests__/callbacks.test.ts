import {
  encodeAbiParameters,
  encodeEventTopics,
  erc20Abi,
  type Hex,
} from "viem";
import {
  createApp,
  createConfiguredChain,
  address,
  USDC,
} from "../../../test/factories";
import { createQuoteRow, createTransferRow } from "../../../test/transfers";
import { KeyType, KeyVars, TransferStatus } from "../../../shared/constants";
import { beforeEach, describe, expect, it } from "vitest";
import { resetMocks, schedulerMock } from "../../../test/mocks";
import { transfer, deposit } from "../../../db/schema";
import { createHmac } from "node:crypto";
import { KvService } from "../../../services/Kv.service";
import { gzipSync } from "node:zlib";
import { app } from "../../../test/api";
import { db } from "../../../db";
import { eq } from "drizzle-orm";

const TOKEN = "qn-security-token";
const SENDER = address(0x5e1);

const post = async (
  path: string,
  body: Uint8Array | string,
  headers: Record<string, string>,
) => {
  const response = await app.handle(
    new Request(`http://localhost${path}`, {
      method: "POST",
      headers,
      body: typeof body === "string" ? body : (body as BodyInit),
    }),
  );

  return {
    status: response.status,
    json: await response.json().catch(() => null),
  };
};

const signedHeaders = (rawBody: string, extra: Record<string, string> = {}) => {
  const timestamp = String(Math.floor(Date.now() / 1000));
  const nonce = "qn-nonce-1";

  return {
    "content-type": "application/json",
    "x-qn-timestamp": timestamp,
    "x-qn-nonce": nonce,
    "x-qn-signature": createHmac("sha256", TOKEN)
      .update(`${nonce}${timestamp}${rawBody}`)
      .digest("hex"),
    ...extra,
  };
};

describe("provider callbacks", () => {
  let payin: string;
  let transferId: string;

  beforeEach(async () => {
    resetMocks();

    await new KvService().upsertKv({
      key: KeyVars.QuickNodeWebhookSecurityToken,
      type: KeyType.SecureString,
      value: TOKEN,
    });

    const appRow = await createApp();
    const result = await createConfiguredChain();
    const quote = await createQuoteRow({
      appId: appRow.id,
      chainId: result.chain.id,
      sourceTokenId: result.usdc.id,
      targetTokenId: result.usdc.id,
      sourceAmount: 1_000_000n,
    });

    const row = await createTransferRow({
      appId: appRow.id,
      quote,
    });

    payin = row.payinAddress;
    transferId = row.id;
  });

  const depositPayload = (amount = 1_000_000n) => ({
    matchingTransactions: [
      {
        chainId: "0x2105",
        from: SENDER,
        to: USDC,
        hash: `0x${"cd".repeat(32)}`,
        value: "0x0",
      },
    ],
    matchingReceipts: [
      {
        status: "0x1",
        transactionHash: `0x${"cd".repeat(32)}`,
        logs: [
          {
            address: USDC,
            topics: encodeEventTopics({
              abi: erc20Abi,
              eventName: "Transfer",
              args: { from: SENDER as Hex, to: payin as Hex },
            }),
            data: encodeAbiParameters([{ type: "uint256" }], [amount]),
            logIndex: "0x2",
            transactionHash: `0x${"cd".repeat(32)}`,
          },
        ],
      },
    ],
  });

  it("records a deposit announced by a correctly signed callback", async () => {
    const raw = JSON.stringify(depositPayload());
    const res = await post(
      "/callback/QuickNode/addressActivity",
      raw,
      signedHeaders(raw),
    );

    expect(res).toMatchObject({ status: 200, json: { received: 1 } });
    expect(await db.select().from(deposit)).toHaveLength(1);

    const [row] = await db
      .select()
      .from(transfer)
      .where(eq(transfer.id, transferId));

    expect(row.status).toBe(TransferStatus.DepositReceived);
    expect(schedulerMock.enqueueSettle).toHaveBeenCalledWith(transferId);
  });

  it("accepts gzip-compressed callbacks, signed over the decompressed payload", async () => {
    const raw = JSON.stringify(depositPayload());
    const res = await post(
      "/callback/QuickNode/addressActivity",
      gzipSync(Buffer.from(raw)),
      signedHeaders(raw, { "content-encoding": "gzip" }),
    );

    expect(res).toMatchObject({
      status: 200,
      json: { received: 1 },
    });
  });

  it("rejects a callback with a wrong signature and records nothing", async () => {
    const raw = JSON.stringify(depositPayload());
    const res = await post(
      "/callback/QuickNode/addressActivity",
      raw,
      signedHeaders(raw, {
        "x-qn-signature": "00".repeat(32),
      }),
    );

    expect(res.status).toBe(401);
    expect(await db.select().from(deposit)).toHaveLength(0);
  });

  it("rejects a payload changed after signing", async () => {
    const signed = JSON.stringify(depositPayload(1n));
    const tampered = JSON.stringify(depositPayload(1_000_000n));

    const res = await post(
      "/callback/QuickNode/addressActivity",
      tampered,
      signedHeaders(signed),
    );

    expect(res.status).toBe(401);
    expect(await db.select().from(deposit)).toHaveLength(0);
  });

  it("rejects callbacks when no security token is configured", async () => {
    await new KvService().deleteKv(KeyVars.QuickNodeWebhookSecurityToken);

    const raw = JSON.stringify(depositPayload());
    const res = await post(
      "/callback/QuickNode/addressActivity",
      raw,
      signedHeaders(raw),
    );

    expect(res.status).toBe(401);
  });

  it("acknowledges callbacks with nothing for us", async () => {
    const raw = JSON.stringify({
      matchingTransactions: [],
      matchingReceipts: [],
    });

    const res = await post(
      "/callback/QuickNode/contractEvent",
      raw,
      signedHeaders(raw),
    );

    expect(res).toMatchObject({
      status: 200,
      json: { received: 0 },
    });
  });

  it.each([
    ["an unknown provider", "/callback/Nope/addressActivity"],
    ["a provider that cannot notify", "/callback/Alchemy/addressActivity"],
    ["an unknown activity", "/callback/QuickNode/everything"],
  ])("returns 422 for %s", async (_label, path) => {
    const raw = "{}";

    expect((await post(path, raw, signedHeaders(raw))).status).toBe(422);
  });

  it("refuses oversized callbacks", async () => {
    const raw = "x".repeat(26 * 1024 * 1024);
    const res = await post(
      "/callback/QuickNode/addressActivity",
      raw,
      signedHeaders("{}"),
    );

    expect(res.status).toBe(413);
  });

  it("refuses gzip payloads that expand beyond the limit", async () => {
    const raw = "0".repeat(60 * 1024 * 1024);
    const res = await post(
      "/callback/QuickNode/addressActivity",
      gzipSync(Buffer.from(raw)),
      signedHeaders("{}", { "content-encoding": "gzip" }),
    );

    expect(res.status).toBe(413);
  });

  it("rejects bodies that are not json", async () => {
    const raw = "not json";
    const res = await post(
      "/callback/QuickNode/addressActivity",
      raw,
      signedHeaders(raw),
    );

    expect(res.status).toBe(400);
  });
});
