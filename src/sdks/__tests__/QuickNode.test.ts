import {
  encodeAbiParameters,
  encodeEventTopics,
  erc20Abi,
  type Hex,
} from "viem";
import { describe, expect, it } from "vitest";
import { address, USDC, ZERO } from "../../test/factories";
import { Kite__factory } from "@kite-01/contracts/typechain/factories/contracts/Kite__factory.js";
import { createHmac } from "node:crypto";
import { QuickNode } from "../QuickNode";
import { KeyVars } from "../../shared/constants";
import { common } from "../../shared/common";

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
