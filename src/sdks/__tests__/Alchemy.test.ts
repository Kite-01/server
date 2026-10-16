import {
  encodeAbiParameters,
  encodeEventTopics,
  erc20Abi,
  type Hex,
} from "viem";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeActor, resetMocks, testMnemonic } from "../../test/mocks";
import { mnemonicToAccount } from "viem/accounts";
import { address, USDC, ZERO } from "../../test/factories";
import { KeyType, KeyVars } from "../../shared/constants";
import { Kite__factory } from "@kite-01/contracts/typechain/factories/contracts/Kite__factory.js";
import { createHmac } from "node:crypto";
import { KvService } from "../../services/Kv.service";
import { Alchemy } from "../Alchemy";

const http = vi.hoisted(() => ({ post: vi.fn(), patch: vi.fn() }));

vi.mock("../Http", () => ({
  Http: class {
    post = http.post;
    patch = http.patch;
  },
}));

const wallet = vi.hoisted(() => ({
  createSmartWalletClient: vi.fn(),
  prepareCalls: vi.fn(),
}));

vi.mock("@alchemy/wallet-apis", () => ({
  alchemyWalletTransport: vi.fn(),
  createSmartWalletClient: wallet.createSmartWalletClient,
}));

const alchemy = new Alchemy();
const kv = new KvService();

const PAYIN = address(0xca11);
const SENDER = address(0x5e1);
const HASH = `0x${"ab".repeat(32)}` as Hex;

const sdkOptions = async () => ({
  variables: {
    ...(await kv.getSdkOptionVariables()),
    [KeyVars.AlchemyAuthToken]: "alchemy-token",
  },
});

const storedWebhooks = async (key: KeyVars) =>
  JSON.parse((await kv.getKv(key))?.value ?? "null");

describe("Alchemy notifiers", () => {
  beforeEach(() => {
    resetMocks();
    http.post.mockReset();
    http.patch.mockReset();

    http.post.mockImplementation(async (url: string, body: any) =>
      url === "/create-webhook"
        ? {
            isOk: true,
            data: {
              data: {
                id: `wh:${body.network}`,
                signing_key: `key:${body.network}`,
              },
            },
          }
        : { isOk: false, statusCode: 404 },
    );
    http.patch.mockResolvedValue({ isOk: true, data: {} });
  });

  it("creates one address activity webhook per network and adds later addresses to it", async () => {
    await alchemy.trackAddressActivity(
      { caip2Id: "eip155:8453", address: PAYIN },
      await sdkOptions(),
    );
    await alchemy.trackAddressActivity(
      { caip2Id: "eip155:8453", address: SENDER },
      await sdkOptions(),
    );
    await alchemy.trackAddressActivity(
      { caip2Id: "eip155:1", address: SENDER },
      await sdkOptions(),
    );

    expect(http.post.mock.calls.map(([url, body]) => [url, body])).toEqual([
      [
        "/create-webhook",
        {
          network: "BASE_MAINNET",
          webhook_type: "ADDRESS_ACTIVITY",
          webhook_url: "http://localhost:3000/callback/Alchemy/addressActivity",
          name: "Track EVM wallet activity (BASE_MAINNET)",
          addresses: [PAYIN.toLowerCase()],
        },
      ],
      [
        "/create-webhook",
        expect.objectContaining({
          network: "ETH_MAINNET",
          addresses: [SENDER.toLowerCase()],
        }),
      ],
    ]);
    expect(http.patch).toHaveBeenCalledWith("/update-webhook-addresses", {
      webhook_id: "wh:BASE_MAINNET",
      addresses_to_add: [SENDER.toLowerCase()],
      addresses_to_remove: [],
    });

    const stored = await kv.getKv(KeyVars.AlchemyAddressActivity_Webhooks);
    expect(stored?.type).toBe(KeyType.SecureString);
    expect(
      await storedWebhooks(KeyVars.AlchemyAddressActivity_Webhooks),
    ).toEqual({
      BASE_MAINNET: { id: "wh:BASE_MAINNET", signingKey: "key:BASE_MAINNET" },
      ETH_MAINNET: { id: "wh:ETH_MAINNET", signingKey: "key:ETH_MAINNET" },
    });
  });

  it("keeps contract event webhooks apart from address activity ones", async () => {
    await alchemy.trackKiteContractEvent(
      { caip2Id: "eip155:8453", contractAddress: PAYIN },
      await sdkOptions(),
    );

    expect(http.post).toHaveBeenCalledWith(
      "/create-webhook",
      expect.objectContaining({
        webhook_url: "http://localhost:3000/callback/Alchemy/contractEvent",
      }),
    );
    expect(
      await storedWebhooks(KeyVars.AlchemyContractEvents_Webhooks),
    ).toEqual({
      BASE_MAINNET: {
        id: "wh:BASE_MAINNET",
        signingKey: "key:BASE_MAINNET",
      },
    });
    expect(await kv.getKv(KeyVars.AlchemyAddressActivity_Webhooks)).toBeNull();
  });

  describe("isValidCallback", () => {
    const rawBody = JSON.stringify({ webhookId: "wh-1", event: {} });
    const options = {
      variables: {
        [KeyVars.AlchemyAddressActivity_Webhooks]: JSON.stringify({
          BASE_MAINNET: { id: "wh-1", signingKey: "signing-key" },
        }),
      },
    };

    const sign = (body: string, key = "signing-key") =>
      createHmac("sha256", key).update(body).digest("hex");

    it("verifies the signature with the sending webhook's key", async () => {
      expect(
        await alchemy.isValidCallback(
          {
            body: JSON.parse(rawBody),
            headers: { "x-alchemy-signature": sign(rawBody) },
            rawBody,
          },
          options,
        ),
      ).toBe(true);
    });

    it("rejects tampered bodies, other keys and unknown webhooks", async () => {
      const tampered = rawBody.replace("{}", '{"x":1}');

      for (const input of [
        {
          body: JSON.parse(tampered),
          rawBody: tampered,
          signature: sign(rawBody),
        },
        {
          body: JSON.parse(rawBody),
          rawBody,
          signature: sign(rawBody, "other"),
        },
        {
          body: { webhookId: "wh-2", event: {} },
          rawBody,
          signature: sign(rawBody),
        },
        { body: JSON.parse(rawBody), rawBody, signature: "" },
      ]) {
        expect(
          await alchemy.isValidCallback(
            {
              body: input.body,
              headers: { "x-alchemy-signature": input.signature },
              rawBody: input.rawBody,
            },
            options,
          ),
        ).toBe(false);
      }
    });
  });

  describe("handleCallback", () => {
    const getTransaction = vi.fn();
    const getTransactionReceipt = vi.fn();

    const payload = {
      event: {
        network: "BASE_MAINNET",
        activity: [{ hash: HASH }, { hash: HASH }],
      },
    };

    const transferLog = (to: string, amount: bigint, logIndex = 7) => ({
      address: USDC,
      topics: encodeEventTopics({
        abi: erc20Abi,
        eventName: "Transfer",
        args: { from: SENDER as Hex, to: to as Hex },
      }) as Hex[],
      data: encodeAbiParameters([{ type: "uint256" }], [amount]),
      logIndex,
      transactionHash: HASH,
    });

    const refundedLog = {
      address: PAYIN,
      topics: encodeEventTopics({
        abi: Kite__factory.abi,
        eventName: "Refunded",
        args: {
          transferId: `0x${"00".repeat(31)}01`,
          refundAddress: SENDER,
          payInToken: USDC,
        },
      }) as Hex[],
      data: encodeAbiParameters([{ type: "uint256" }], [42n]),
      logIndex: 1,
      transactionHash: HASH,
    };

    const mine = (transaction: object, logs: object[], status = "success") => {
      getTransaction.mockResolvedValue({
        hash: HASH,
        from: SENDER,
        to: PAYIN,
        value: 0n,
        ...transaction,
      });
      getTransactionReceipt.mockResolvedValue({
        status,
        transactionHash: HASH,
        logs,
      });
    };

    beforeEach(() => {
      getTransaction.mockReset();
      getTransactionReceipt.mockReset();
      fakeActor.publicClient.mockResolvedValue({
        getTransaction,
        getTransactionReceipt,
      });
    });

    it("reports native and ERC-20 deposits once per transaction", async () => {
      mine({ value: 1000n }, [transferLog(PAYIN, 2_500_000n)]);

      const items = await alchemy.handleCallback("addressActivity", payload);

      expect(getTransaction).toHaveBeenCalledTimes(1);
      expect(items).toEqual([
        {
          type: "DepositReceived",
          caip2Id: "eip155:8453",
          blockchainHash: HASH,
          logIndex: "native",
          from: SENDER,
          payinAddress: PAYIN,
          tokenAddress: ZERO,
          amount: 1000n,
        },
        {
          type: "DepositReceived",
          caip2Id: "eip155:8453",
          blockchainHash: HASH,
          logIndex: "7",
          from: SENDER,
          payinAddress: PAYIN,
          tokenAddress: USDC,
          amount: 2_500_000n,
        },
      ]);
    });

    it("ignores failed transactions and a clone's own transfers", async () => {
      mine({ value: 1000n }, [transferLog(PAYIN, 1n)], "reverted");
      expect(await alchemy.handleCallback("addressActivity", payload)).toEqual(
        [],
      );

      mine({ to: USDC }, [transferLog(PAYIN, 5n), refundedLog]);
      expect(await alchemy.handleCallback("addressActivity", payload)).toEqual(
        [],
      );
    });

    it("reads Kite contract events from the receipt", async () => {
      mine({ to: PAYIN }, [refundedLog]);

      expect(await alchemy.handleCallback("contractEvent", payload)).toEqual([
        expect.objectContaining({
          type: "Refunded",
          payinAddress: PAYIN,
          refundAddress: SENDER,
          amountRefunded: 42n,
        }),
      ]);
    });

    it("ignores networks this server doesn't run", async () => {
      expect(
        await alchemy.handleCallback("addressActivity", {
          event: { network: "MONAD_TESTNET", activity: [{ hash: HASH }] },
        }),
      ).toEqual([]);
      expect(getTransaction).not.toHaveBeenCalled();
    });
  });
});

describe("Alchemy gas sponsor", () => {
  const signer = mnemonicToAccount(testMnemonic);
  const options = {
    variables: {
      [KeyVars.AlchemyApiKey]: "api-key",
      [KeyVars.AlchemyGasPolicyId]: "policy",
    },
  };

  beforeEach(() => {
    wallet.prepareCalls.mockReset();
    wallet.createSmartWalletClient
      .mockReset()
      .mockReturnValue({ prepareCalls: wallet.prepareCalls });
  });

  it("can sponsor calls when Alchemy prepares a sponsored call on the chain", async () => {
    wallet.prepareCalls.mockResolvedValue({ type: "user-operation-v070" });

    expect(await alchemy.canSponsorCalls("eip155:8453", signer, options)).toBe(
      true,
    );
    expect(wallet.createSmartWalletClient).toHaveBeenCalledWith(
      expect.objectContaining({
        chain: expect.objectContaining({ id: 8453 }),
        signer,
        paymaster: { policyId: "policy" },
      }),
    );
    expect(wallet.prepareCalls).toHaveBeenCalledWith({
      calls: [{ to: ZERO }],
    });
  });

  it("cannot when Alchemy refuses to prepare it", async () => {
    wallet.prepareCalls.mockRejectedValue(new Error("Unsupported chain"));

    expect(await alchemy.canSponsorCalls("eip155:8453", signer, options)).toBe(
      false,
    );
  });
});
