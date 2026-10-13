import {
  createApiKey,
  createApp,
  createConfiguredChain,
  address,
  USDC,
} from "../../../test/factories";
import { fakeActor, operatorAddress, resetMocks } from "../../../test/mocks";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { client, publicCall, rootCredentials } from "../../../test/api";
import { createQuoteRow, createTransferRow } from "../../../test/transfers";
import { ApiKeyScope } from "../../../shared/constants";

const facilitator = vi.hoisted(() => ({
  verify: vi.fn(),
  settle: vi.fn(),
}));

vi.mock("@x402/core/facilitator", () => ({
  x402Facilitator: class {
    register() {
      return this;
    }
    verify = facilitator.verify;
    settle = facilitator.settle;
  },
}));

vi.mock("@x402/evm/exact/facilitator", () => ({
  ExactEvmScheme: class {},
}));

const PAYER = address(0x9a7);

describe("x402 API", () => {
  let appId: string;
  let transferRow: Awaited<ReturnType<typeof createTransferRow>>;
  let key: Awaited<ReturnType<typeof createApiKey>>;

  beforeEach(async () => {
    resetMocks();
    facilitator.verify
      .mockReset()
      .mockResolvedValue({ isValid: true, payer: PAYER });
    facilitator.settle.mockReset().mockResolvedValue({
      success: true,
      payer: PAYER,
      transaction: "0xsettled",
      network: "eip155:8453",
    });
    fakeActor.publicClient.mockResolvedValue({
      multicall: vi
        .fn()
        .mockResolvedValue([
          { result: "USD Coin" },
          { result: "2" },
          { result: false },
        ]),
    });

    const app = await createApp();
    appId = app.id;

    const { chain, usdc } = await createConfiguredChain();
    const quote = await createQuoteRow({
      appId,
      chainId: chain.id,
      sourceTokenId: usdc.id,
      targetTokenId: usdc.id,
    });

    transferRow = await createTransferRow({
      appId,
      quote,
      refundAddress: operatorAddress,
    });

    key = await createApiKey(appId, {
      scopes: [ApiKeyScope.x402],
    });
  });

  const body = () => {
    const requirements = {
      scheme: "exact",
      network: "eip155:8453",
      asset: USDC,
      amount: "1000000",
      payTo: transferRow.payinAddress,
      maxTimeoutSeconds: 60,
      extra: {
        name: "USD Coin",
        version: "2",
      },
    };

    return {
      x402Version: 2,
      paymentRequirements: requirements,
      paymentPayload: {
        x402Version: 2,
        accepted: requirements,
        payload: {
          signature: `0x${"ab".repeat(65)}`,
          authorization: {
            from: PAYER,
            to: transferRow.payinAddress,
            value: "1000000",
            validAfter: "0",
            validBefore: String(Math.floor(Date.now() / 1000) + 60),
            nonce: `0x${"11".repeat(32)}`,
          },
        },
      },
    };
  };

  it("advertises supported payment kinds to anyone with a key id and public key", async () => {
    const res = await publicCall(
      key.row.id,
      key.publicKey,
      "GET",
      "/api/x402/supported",
    );

    expect(res.status).toBe(200);
    expect(res.json.kinds).toEqual([
      expect.objectContaining({
        scheme: "exact",
        network: "eip155:8453",
      }),
    ]);

    expect(res.json.signers).toEqual({
      "eip155:*": [operatorAddress],
    });
  });

  it("serves payment requirements for a transfer", async () => {
    const res = await client(key.credentials).get(
      `/api/x402/transfer/${transferRow.id}/requirements`,
    );

    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({
      scheme: "exact",
      asset: USDC,
      amount: "1000000",
      payTo: transferRow.payinAddress,
    });
  });

  it("verifies and settles payments", async () => {
    const api = client(key.credentials);

    const verified = await api.post("/api/x402/verify", body());
    expect(verified).toMatchObject({
      status: 200,
      json: {
        isValid: true,
      },
    });

    const settled = await api.post("/api/x402/settle", body());
    expect(settled).toMatchObject({
      status: 200,
      json: {
        success: true,
        transaction: "0xsettled",
      },
    });
  });

  it("requires the x402 scope and a signature", async () => {
    const other = await createApiKey(appId, {
      scopes: [ApiKeyScope.QuoteRead],
    });

    const res1 = await client(other.credentials).post(
      "/api/x402/settle",
      body(),
    );

    expect(res1.status).toBe(403);

    const res2 = await publicCall(
      key.row.id,
      key.publicKey,
      "POST",
      "/api/x402/settle",
      { body: body() },
    );

    expect(res2.status).toBe(401);
  });

  it("does not settle payments for another app's transfer", async () => {
    const app = await createApp();
    const otherKey = await createApiKey(app.id, {
      scopes: [ApiKeyScope.x402],
    });

    const res = await client(otherKey.credentials).post(
      "/api/x402/settle",
      body(),
    );

    expect(res.status).toBe(404);
    expect(facilitator.settle).not.toHaveBeenCalled();
  });

  it("reports mismatched payment terms as a conflict", async () => {
    const wrong = body();
    wrong.paymentRequirements.amount = "5";

    const res = await client(key.credentials).post("/api/x402/verify", wrong);

    expect(res.status).toBe(409);
    expect(res.json.error.code).toBe("PreconditionFailed");
  });

  it("lets the root key act for an app", async () => {
    const res = await client(rootCredentials(appId)).post(
      "/api/x402/verify",
      body(),
    );

    expect(res.status).toBe(200);
  });
});
