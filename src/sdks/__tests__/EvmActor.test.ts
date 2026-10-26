import {
  keccak256,
  nonceManager,
  numberToHex,
  parseTransaction,
  recoverTransactionAddress,
  type Hex,
  type TransactionSerialized,
} from "viem";
import {
  OperatorTransactionFailedError,
  OperatorTransactionPendingError,
} from "../../shared/errors";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { operatorAddress } from "../../test/mocks";
import { Provider } from "../../shared/constants";
import { EvmActor } from "../EvmActor";
import { address } from "../../test/factories";

const rpc = vi.hoisted(() => ({
  request: (async () => undefined) as (args: {
    method: string;
    params?: unknown;
  }) => Promise<unknown>,
}));

const chain = vi.hoisted(() => ({
  config: {
    rpcUrls: null,
    gasSponsorProviders: [] as string[],
  },
}));

const sponsor = vi.hoisted(() => ({
  submitSponsoredCalls: vi.fn(),
  getSponsoredCallsStatus: vi.fn(),
  getSponsorshipError: vi.fn(),
}));

vi.mock("../../shared/chains", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../shared/chains")>();
  const { custom } = await import("viem");

  return {
    ...actual,
    getRpcsTransport: () => custom({ request: (args) => rpc.request(args) }),
  };
});

vi.mock("../../shared/providers", () => ({
  getProvider: vi.fn(() => sponsor),
}));

vi.mock("../../services/Chain.service", () => ({
  ChainService: class {
    getChainByCaip2Id = async () => chain;
  },
}));

const CAIP2 = "eip155:8453" as Caip2Id;
const CHAIN_ID = 8453;
const TO = address(0x70);
const options: SdkOptions = { variables: {} };

const rpcError = (code: number, message: string) =>
  Object.assign(new Error(message), { code });

// mines every transaction it accepts at once and refuses a nonce it has seen
const fakeNode = ({ reverts = false } = {}) => {
  const sent: Array<{ hash: Hex; nonce: number; from: string; to?: string }> =
    [];
  const statuses = new Map<string, "0x1" | "0x0">();
  const block = { number: 100n, hash: `0x${"b".repeat(64)}` as Hex };

  const request = async ({
    method,
    params,
  }: {
    method: string;
    params?: unknown;
  }) => {
    const args = (params ?? []) as unknown[];
    // a network round trip, so concurrent sends interleave as they would live
    await new Promise((resolve) => setTimeout(resolve, 1));

    switch (method) {
      case "eth_chainId":
        return numberToHex(CHAIN_ID);
      case "eth_blockNumber":
        return numberToHex(block.number);
      case "eth_getBlockByNumber":
        return {
          number: numberToHex(block.number),
          hash: block.hash,
          timestamp: "0x1",
          baseFeePerGas: "0x1",
          gasLimit: "0x1c9c380",
          gasUsed: "0x0",
          transactions: [],
        };
      case "eth_maxPriorityFeePerGas":
        return "0x1";
      case "eth_estimateGas":
        return "0x5208";
      case "eth_getTransactionCount":
        return numberToHex(sent.length);
      case "eth_sendRawTransaction": {
        const raw = args[0] as TransactionSerialized;
        const tx = parseTransaction(raw);
        if (sent.some((item) => item.nonce === tx.nonce))
          throw rpcError(-32003, "nonce too low");

        const hash = keccak256(raw);
        sent.push({
          hash,
          nonce: tx.nonce!,
          from: await recoverTransactionAddress({ serializedTransaction: raw }),
          to: tx.to ?? undefined,
        });
        statuses.set(hash, reverts ? "0x0" : "0x1");
        return hash;
      }
      case "eth_getTransactionReceipt": {
        const hash = args[0] as Hex;
        const status = statuses.get(hash);
        if (!status) return null;

        return {
          transactionHash: hash,
          transactionIndex: "0x0",
          blockHash: block.hash,
          blockNumber: numberToHex(block.number),
          from: operatorAddress,
          to: TO,
          cumulativeGasUsed: "0x5208",
          gasUsed: "0x5208",
          effectiveGasPrice: "0x2",
          contractAddress: null,
          logs: [],
          logsBloom: `0x${"0".repeat(512)}`,
          status,
          type: "0x2",
        };
      }
    }

    throw rpcError(-32601, `the method ${method} does not exist`);
  };

  return { request, sent };
};

describe("EvmActor", () => {
  let actor: EvmActor;
  let node: ReturnType<typeof fakeNode>;

  const useSponsor = (providers: Provider[]) => {
    chain.config.gasSponsorProviders = providers;
  };

  beforeEach(() => {
    nonceManager.reset({ address: operatorAddress, chainId: CHAIN_ID });
    for (const fn of Object.values(sponsor)) fn.mockReset();

    node = fakeNode();
    rpc.request = node.request;
    actor = new EvmActor();
  });

  describe("on a chain without a gas sponsor", () => {
    beforeEach(() => useSponsor([]));

    it("sends from the operator wallet and returns once the transaction is mined", async () => {
      const onSubmitted = vi.fn(async () => undefined);

      const hash = await actor.sendTransaction(
        { caip2Id: CAIP2, to: TO, data: "0x1234", value: 0n },
        options,
        { onSubmitted },
      );

      expect(node.sent).toEqual([
        { hash, nonce: 0, from: operatorAddress, to: expect.any(String) },
      ]);
      expect(node.sent[0].to?.toLowerCase()).toBe(TO.toLowerCase());
      expect(onSubmitted).toHaveBeenCalledWith(hash);
      expect(sponsor.submitSponsoredCalls).not.toHaveBeenCalled();
    });

    it("throws when the transaction reverts", async () => {
      node = fakeNode({ reverts: true });
      rpc.request = node.request;

      const error = await actor
        .sendTransaction({ caip2Id: CAIP2, to: TO, value: 0n }, options)
        .catch((e) => e);

      expect(error).toBeInstanceOf(OperatorTransactionFailedError);
      expect(error).toMatchObject({
        callId: node.sent[0].hash,
        transactionHash: node.sent[0].hash,
      });
    });

    it("throws a pending error carrying the hash when it can't see the receipt", async () => {
      vi.spyOn(actor, "waitForReceipt").mockRejectedValueOnce(
        new Error("timed out"),
      );

      const error = await actor
        .sendTransaction({ caip2Id: CAIP2, to: TO, value: 0n }, options)
        .catch((e) => e);

      expect(error).toBeInstanceOf(OperatorTransactionPendingError);
      expect(error.callId).toBe(node.sent[0].hash);
    });

    it("gives transactions sent at the same time their own nonces", async () => {
      const hashes = await Promise.all(
        [1, 2, 3].map(() =>
          actor.sendTransaction({ caip2Id: CAIP2, to: TO, value: 0n }, options),
        ),
      );

      expect(new Set(hashes).size).toBe(3);
      expect(node.sent.map((tx) => tx.nonce).sort()).toEqual([0, 1, 2]);
    });

    it("reads the status of a transaction it sent from its receipt", async () => {
      const hash = await actor.sendTransaction(
        { caip2Id: CAIP2, to: TO, value: 0n },
        options,
      );

      expect(await actor.getTransactionStatus(CAIP2, hash, options)).toEqual({
        status: "success",
        transactionHash: hash,
      });
      expect(
        await actor.getTransactionStatus(CAIP2, `0x${"1".repeat(64)}`, options),
      ).toEqual({ status: "pending" });
      expect(sponsor.getSponsoredCallsStatus).not.toHaveBeenCalled();
    });

    it("reports a reverted transaction as failed", async () => {
      node = fakeNode({ reverts: true });
      rpc.request = node.request;
      await actor
        .sendTransaction({ caip2Id: CAIP2, to: TO, value: 0n }, options)
        .catch(() => undefined);

      const hash = node.sent[0].hash;
      expect(await actor.getTransactionStatus(CAIP2, hash, options)).toEqual({
        status: "failure",
        transactionHash: hash,
      });
    });
  });

  describe("on a chain with a gas sponsor", () => {
    beforeEach(() => {
      useSponsor([Provider.Alchemy]);
      sponsor.submitSponsoredCalls.mockResolvedValue({ callId: "call-1" });
      sponsor.getSponsoredCallsStatus.mockResolvedValue({
        status: "success",
        transactionHash: "0xsponsored",
      });
    });

    it("sends through the sponsor", async () => {
      const onSubmitted = vi.fn(async () => undefined);

      const hash = await actor.sendTransaction(
        { caip2Id: CAIP2, to: TO, value: 0n },
        options,
        { onSubmitted },
      );

      expect(hash).toBe("0xsponsored");
      expect(onSubmitted).toHaveBeenCalledWith("call-1");
      expect(node.sent).toEqual([]);
    });

    it("sends from the operator wallet when the caller opts out", async () => {
      const hash = await actor.sendTransaction(
        { caip2Id: CAIP2, to: TO, value: 0n },
        options,
        { useGasSponsor: false },
      );

      expect(node.sent.map((tx) => tx.hash)).toEqual([hash]);
      expect(sponsor.submitSponsoredCalls).not.toHaveBeenCalled();
    });

    it("asks the sponsor about its call ids and the chain about transaction hashes", async () => {
      expect(
        await actor.getTransactionStatus(CAIP2, "call-1", options),
      ).toEqual({ status: "success", transactionHash: "0xsponsored" });

      const hash = await actor.sendTransaction(
        { caip2Id: CAIP2, to: TO, value: 0n },
        options,
        { useGasSponsor: false },
      );
      sponsor.getSponsoredCallsStatus.mockClear();

      expect(await actor.getTransactionStatus(CAIP2, hash, options)).toEqual({
        status: "success",
        transactionHash: hash,
      });
      expect(sponsor.getSponsoredCallsStatus).not.toHaveBeenCalled();
    });
  });
});
