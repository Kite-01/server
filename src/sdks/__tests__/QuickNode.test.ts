import {
  encodeAbiParameters,
  encodeEventTopics,
  erc20Abi,
  type Hex,
} from "viem";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { address, USDC, ZERO } from "../../test/factories";
import { KeyVarPrefix, KeyVars, networkKeyVar } from "../../shared/constants";
import { Kite__factory } from "@kite-01/contracts/typechain/factories/contracts/Kite__factory.js";
import { createHmac } from "node:crypto";
import { KvService } from "../../services/Kv.service";
import { QuickNode } from "../QuickNode";
import { common } from "../../shared/common";

const http = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));

vi.mock("../Http", () => ({
  Http: class {
    get = http.get;
    post = http.post;
  },
}));

const quickNode = new QuickNode();

const TOKEN = "QuickNodeSecurityToken";
const options = {
  variables: {
    [KeyVars.QuickNodeWebhookSecurityToken]: TOKEN,
  },
};

const sign = (rawBody: string, timestamp: number, nonce = "nonce-1") => {
  return createHmac("sha256", TOKEN)
    .update(`${nonce}${timestamp}${rawBody}`)
    .digest("hex");
};

const headers = (rawBody: string, overrides: Record<string, string> = {}) => {
  const timestamp = Math.floor(Date.now() / 1000);

  return {
    "x-qn-signature": sign(rawBody, timestamp),
    "x-qn-timestamp": String(timestamp),
    "x-qn-nonce": "nonce-1",
    ...overrides,
  };
};

type Log = {
  address: string;
  topics: string[];
  data: string;
  logIndex: string;
  transactionHash: string;
};

describe("QuickNode callbacks", () => {
  describe("isValidCallback", () => {
    it("verifies the signature over the raw body, not a re-serialisation", async () => {
      const rawBody =
        '{ "matchingReceipts" : [],  "matchingTransactions": [] }';

      const valid = await quickNode.isValidCallback(
        { body: common.toJson(rawBody), headers: headers(rawBody), rawBody },
        options,
      );

      expect(valid).toBe(true);
    });

    it("rejects a body that was changed after signing", async () => {
      const signed = '{"matchingReceipts":[]}';
      const received = '{"matchingReceipts":[1]}';

      const response = await quickNode.isValidCallback(
        {
          body: common.toJson(received),
          headers: headers(signed),
          rawBody: received,
        },
        options,
      );

      expect(response).toBe(false);
    });

    it("rejects missing, stale and mismatching signatures", async () => {
      const rawBody = "{}";
      const base = { body: {}, rawBody };

      expect(
        await quickNode.isValidCallback(
          {
            ...base,
            headers: {},
          },
          options,
        ),
      ).toBe(false);

      const staleTimestamp = Math.floor(Date.now() / 1000) - 3600;

      expect(
        await quickNode.isValidCallback(
          {
            ...base,
            headers: {
              "x-qn-signature": sign(rawBody, staleTimestamp),
              "x-qn-timestamp": String(staleTimestamp),
              "x-qn-nonce": "nonce-1",
            },
          },
          options,
        ),
      ).toBe(false);

      expect(
        await quickNode.isValidCallback(
          {
            ...base,
            headers: headers(rawBody, {
              "x-qn-signature": "00",
            }),
          },
          options,
        ),
      ).toBe(false);
    });
  });

  describe("handleCallback", () => {
    const PAYIN = address(0xca11);
    const SENDER = address(0x5e1);
    const HASH = `0x${"ab".repeat(32)}`;

    const addressActivity = (
      transaction: object,
      logs: Log[] = [],
      status = "0x1",
    ) => {
      return {
        matchingTransactions: [
          {
            chainId: "0x2105",
            from: SENDER,
            to: PAYIN,
            hash: HASH,
            value: "0x0",
            ...transaction,
          },
        ],
        matchingReceipts: [
          {
            status,
            transactionHash: HASH,
            logs,
          },
        ],
      };
    };

    it("reports a native deposit once", async () => {
      const items = await quickNode.handleCallback(
        "addressActivity",
        addressActivity({ value: "0x3e8" }),
      );

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
      ]);
    });

    it("reports an ERC-20 deposit from its Transfer log", async () => {
      const log = {
        address: USDC,
        topics: encodeEventTopics({
          abi: erc20Abi,
          eventName: "Transfer",
          args: {
            from: SENDER as Hex,
            to: PAYIN as Hex,
          },
        }) as string[],
        data: encodeAbiParameters([{ type: "uint256" }], [2_500_000n]),
        logIndex: "0x7",
        transactionHash: HASH,
      };

      const items = await quickNode.handleCallback(
        "addressActivity",
        addressActivity({}, [log]),
      );

      expect(items).toEqual([
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

    it("ignores transactions that failed", async () => {
      const items = await quickNode.handleCallback(
        "addressActivity",
        addressActivity({ value: "0x3e8" }, [], "0x0"),
      );

      expect(items).toEqual([]);
    });

    it("reads Kite contract events from receipts", async () => {
      const topics = encodeEventTopics({
        abi: Kite__factory.abi,
        eventName: "Refunded",
        args: {
          transferId: `0x${"00".repeat(31)}01`,
          refundAddress: SENDER,
          payInToken: USDC,
        },
      }) as string[];

      const items = await quickNode.handleCallback("contractEvent", {
        matchingTransactions: [
          {
            chainId: "0x2105",
            from: SENDER,
            to: PAYIN,
            hash: HASH,
            value: "0x0",
          },
        ],
        matchingReceipts: [
          {
            status: "0x1",
            transactionHash: HASH,
            logs: [
              {
                address: PAYIN,
                topics,
                data: encodeAbiParameters([{ type: "uint256" }], [42n]),
                logIndex: "0x1",
                transactionHash: HASH,
              },
            ],
          },
        ],
      });

      expect(items).toEqual([
        expect.objectContaining({
          type: "Refunded",
          payinAddress: PAYIN,
          refundAddress: SENDER,
          amountRefunded: 42n,
        }),
      ]);
    });
  });
});

describe("QuickNode notifiers", () => {
  const kv = new KvService();
  const PAYIN = address(0xca11);
  const OTHER = address(0xbeef);
  const THIRD = address(0xc0ffee);

  let lists: Map<string, string[]>;

  const sdkOptions = async () => ({
    variables: {
      ...(await kv.getSdkOptionVariables()),
      [KeyVars.QuickNodeApiKey]: "qn-key",
    },
  });

  const webhookPosts = () =>
    http.post.mock.calls.filter(([url]) => String(url).startsWith("/webhooks"));

  const storedWebhookId = async (network: string) =>
    (
      await kv.getKv(
        networkKeyVar(KeyVarPrefix.QuickNodeEvmWalletFilter_WebhookId, network),
      )
    )?.value;

  beforeEach(() => {
    lists = new Map();
    http.get.mockReset();
    http.post.mockReset();

    http.get.mockImplementation(async (url: string) => {
      const items = lists.get(url.replace("/kv/rest/v1/lists/", ""));
      return items
        ? { isOk: true, data: { data: { items } } }
        : { isOk: false, statusCode: 404 };
    });

    http.post.mockImplementation(async (url: string, body: any) => {
      if (url === "/kv/rest/v1/lists") {
        lists.set(body.key, [...body.items]);
        return { isOk: true, data: {} };
      }

      const item = url.match(/^\/kv\/rest\/v1\/lists\/(.+)\/items$/);
      if (item) {
        lists.get(item[1])!.push(body.item);
        return { isOk: true, data: {} };
      }

      const template = url.match(
        /^\/webhooks\/rest\/v1\/webhooks\/template\/(.+)$/,
      );
      if (template) {
        return { isOk: true, data: { id: `${template[1]}:${body.network}` } };
      }

      return { isOk: false, statusCode: 404 };
    });
  });

  it("creates one webhook per network, with its filter at the top level", async () => {
    await quickNode.trackAddressActivity(
      { caip2Id: "eip155:8453", address: PAYIN },
      await sdkOptions(),
    );
    await quickNode.trackAddressActivity(
      { caip2Id: "eip155:1", address: OTHER },
      await sdkOptions(),
    );
    await quickNode.trackAddressActivity(
      { caip2Id: "eip155:8453", address: THIRD },
      await sdkOptions(),
    );

    expect(webhookPosts().map(([url, body]) => [url, body.network])).toEqual([
      ["/webhooks/rest/v1/webhooks/template/evmWalletFilter", "base-mainnet"],
      [
        "/webhooks/rest/v1/webhooks/template/evmWalletFilter",
        "ethereum-mainnet",
      ],
    ]);

    const [, body] = webhookPosts()[0];
    expect(body.templateArgs).toEqual({
      walletsListName: "evmWalletFilterWalletsList",
    });
    expect(body.destination_attributes).toEqual({
      url: "http://localhost:3000/callback/QuickNode/addressActivity",
      security_token: expect.any(String),
      compression: "gzip",
    });

    expect(await storedWebhookId("base-mainnet")).toBe(
      "evmWalletFilter:base-mainnet",
    );
    expect(await storedWebhookId("ethereum-mainnet")).toBe(
      "evmWalletFilter:ethereum-mainnet",
    );
    expect(http.get).toHaveBeenCalledWith(
      "/kv/rest/v1/lists/evmWalletFilterWalletsList",
    );
    expect(lists.get("evmWalletFilterWalletsList")).toEqual([
      PAYIN.toLowerCase(),
      OTHER.toLowerCase(),
      THIRD.toLowerCase(),
    ]);
  });

  it("signs both first webhooks with one token when they are created together", async () => {
    const options = await sdkOptions();

    await Promise.all([
      quickNode.trackAddressActivity(
        { caip2Id: "eip155:8453", address: PAYIN },
        options,
      ),
      quickNode.trackKiteContractEvent(
        { caip2Id: "eip155:8453", contractAddress: PAYIN },
        options,
      ),
    ]);

    const tokens = webhookPosts().map(
      ([, body]) => body.destination_attributes.security_token,
    );
    expect(tokens).toHaveLength(2);
    expect(tokens[1]).toBe(tokens[0]);
    expect((await kv.getKv(KeyVars.QuickNodeWebhookSecurityToken))?.value).toBe(
      tokens[0],
    );
    const contractEvents = webhookPosts().find(([url]) =>
      String(url).endsWith("/evmContractEvents"),
    );
    expect(contractEvents?.[1].templateArgs).toEqual({
      contractsListName: "evmContractEventsContractsListName",
      eventHashesListName: "evmContractEventsEventHashesListName",
    });
  });

  it("creates one webhook for a network whose first addresses arrive together", async () => {
    const options = await sdkOptions();
    const respond = http.post.getMockImplementation()!;
    http.post.mockImplementation(async (url: string, body: any) => {
      if (url.startsWith("/webhooks")) {
        await new Promise((resolve) => setTimeout(resolve, 20));
      }

      return respond(url, body);
    });

    await Promise.all([
      quickNode.trackAddressActivity(
        { caip2Id: "eip155:8453", address: PAYIN },
        options,
      ),
      quickNode.trackAddressActivity(
        { caip2Id: "eip155:8453", address: OTHER },
        options,
      ),
      quickNode.trackAddressActivity(
        { caip2Id: "eip155:1", address: THIRD },
        options,
      ),
    ]);

    expect(
      webhookPosts()
        .map(([, body]) => body.network)
        .sort(),
    ).toEqual(["base-mainnet", "ethereum-mainnet"]);
    expect(await storedWebhookId("base-mainnet")).toBe(
      "evmWalletFilter:base-mainnet",
    );
    expect(await storedWebhookId("ethereum-mainnet")).toBe(
      "evmWalletFilter:ethereum-mainnet",
    );
  });
});
