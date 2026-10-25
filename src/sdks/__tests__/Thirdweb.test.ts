import {
  encodeAbiParameters,
  encodeEventTopics,
  hexToNumber,
  parseAbi,
  recoverTypedDataAddress,
  type Hex,
} from "viem";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeActor, resetMocks, testMnemonic } from "../../test/mocks";
import { recoverAuthorizationAddress } from "viem/utils";
import { mnemonicToAccount } from "viem/accounts";
import { Thirdweb } from "../Thirdweb";
import { KeyVars } from "../../shared/constants";
import { address } from "../../test/factories";

const http = vi.hoisted(() => ({ create: vi.fn(), post: vi.fn() }));

vi.mock("../Http", () => ({
  Http: class {
    constructor(...args: unknown[]) {
      http.create(...args);
    }

    post = http.post;
  },
}));

const thirdweb = new Thirdweb();
const signer = mnemonicToAccount(testMnemonic);
const options = {
  variables: {
    [KeyVars.ThirdwebSecretKey]: "secret",
  },
};

const DELEGATION = address(0x7702);
const TARGET = address(0xfac);
const HASH = `0x${"ab".repeat(32)}` as Hex;

const executedLog = (emitter: string) => ({
  address: emitter,
  topics: encodeEventTopics({
    abi: parseAbi([
      "event Executed(address indexed user, address indexed signer, address indexed executor, uint256 batchSize)",
    ]),
    eventName: "Executed",
    args: { user: signer.address, signer: signer.address, executor: TARGET },
  }),
  data: encodeAbiParameters([{ type: "uint256" }], [1n]),
});

describe("Thirdweb gas sponsor", () => {
  const getCode = vi.fn();
  const getTransactionCount = vi.fn();
  const getTransactionReceipt = vi.fn();
  const rpc = new Map<string, unknown>();

  const rpcCalls = (method: string) => {
    return http.post.mock.calls
      .map(([, body]) => body)
      .filter((body) => body.method === method);
  };

  beforeEach(() => {
    resetMocks();
    rpc.clear();
    http.create.mockReset();
    http.post.mockReset();
    getCode.mockReset();
    getTransactionCount.mockReset().mockResolvedValue(7);
    getTransactionReceipt.mockReset();

    fakeActor.publicClient.mockResolvedValue({
      getCode,
      getTransactionCount,
      getTransactionReceipt,
    });

    rpc.set("tw_getDelegationContract", {
      isOk: true,
      data: { result: { delegationContract: DELEGATION } },
    });
    rpc.set("tw_execute", { isOk: true, data: { result: { queueId: "q-1" } } });
    http.post.mockImplementation(async (_url: string, body: any) =>
      rpc.get(body.method),
    );
  });

  describe("submitSponsoredCalls", () => {
    const submit = () =>
      thirdweb.submitSponsoredCalls(
        { caip2Id: "eip155:8453", to: TARGET, data: "0x1234", value: 5n },
        signer,
        options,
      );

    it.each([
      ["not delegated", undefined],
      ["delegated to another account", `0xef0100${"11".repeat(20)}`],
    ])(
      "delegates the operator to thirdweb's account when it is %s",
      async (_, code) => {
        getCode.mockResolvedValue(code);

        expect(await submit()).toEqual({ callId: "q-1" });

        expect(http.create).toHaveBeenCalledWith(
          "https://8453.bundler.thirdweb.com/v2",
          expect.objectContaining({ "x-secret-key": "secret" }),
        );
        expect(getTransactionCount).toHaveBeenCalledWith({
          address: signer.address,
          blockTag: "pending",
        });

        const [{ params }] = rpcCalls("tw_execute");
        const [eoa, wrappedCalls, signature, authorization] = params;

        expect(eoa).toBe(signer.address);
        expect(wrappedCalls).toEqual({
          calls: [{ target: TARGET, value: "0x5", data: "0x1234" }],
          uid: expect.stringMatching(/^0x[0-9a-f]{64}$/),
        });
        expect(authorization).toMatchObject({
          chainId: 8453,
          address: DELEGATION,
          nonce: "0x7",
        });

        expect(
          await recoverAuthorizationAddress({
            authorization: {
              ...authorization,
              nonce: hexToNumber(authorization.nonce),
            },
          }),
        ).toBe(signer.address);

        expect(
          await recoverTypedDataAddress({
            domain: {
              name: "MinimalAccount",
              version: "1",
              chainId: 8453,
              verifyingContract: signer.address,
            },
            types: {
              Call: [
                { name: "target", type: "address" },
                { name: "value", type: "uint256" },
                { name: "data", type: "bytes" },
              ],
              WrappedCalls: [
                { name: "calls", type: "Call[]" },
                { name: "uid", type: "bytes32" },
              ],
            },
            primaryType: "WrappedCalls",
            message: {
              calls: [{ target: TARGET, value: 5n, data: "0x1234" }],
              uid: wrappedCalls.uid,
            },
            signature,
          }),
        ).toBe(signer.address);
      },
    );

    it("sends no authorization once the operator is delegated to thirdweb's account", async () => {
      getCode.mockResolvedValue(`0xef0100${DELEGATION.slice(2).toLowerCase()}`);

      await submit();

      const [{ params }] = rpcCalls("tw_execute");
      expect(params[3]).toBeNull();
      expect(getTransactionCount).not.toHaveBeenCalled();
    });

    it("gives every call its own uid", async () => {
      getCode.mockResolvedValue(undefined);

      await submit();
      await submit();

      const [first, second] = rpcCalls("tw_execute");
      expect(first.params[1].uid).not.toBe(second.params[1].uid);
    });

    it("throws thirdweb's reason when it refuses the call", async () => {
      rpc.set("tw_execute", {
        isOk: false,
        statusCode: 400,
        data: { error: { code: -32602, message: "Invalid signature" } },
      });

      await expect(submit()).rejects.toThrow("Invalid signature");
    });
  });

  describe("getSponsoredCallsStatus", () => {
    const status = () =>
      thirdweb.getSponsoredCallsStatus("eip155:8453", "q-1", signer, options);

    const hash = (transactionHash: Hex | null) => {
      rpc.set("tw_getTransactionHash", {
        isOk: true,
        data: { result: { transactionHash, status: "pending" } },
      });
    };

    it("asks thirdweb for the queued call's transaction", async () => {
      hash(null);

      expect(await status()).toEqual({ status: "pending" });
      expect(rpcCalls("tw_getTransactionHash")[0].params).toEqual(["q-1"]);
    });

    it("stays pending until the receipt can be read", async () => {
      hash(HASH);
      getTransactionReceipt.mockRejectedValue(new Error("not found"));

      expect(await status()).toEqual({ status: "pending" });
    });

    it.each([
      ["ran the calls", "success", [executedLog(signer.address)], "success"],
      ["ran nothing", "success", [], "failure"],
      ["reverted", "reverted", [executedLog(signer.address)], "failure"],
      [
        "has another account's Executed event",
        "success",
        [executedLog(TARGET)],
        "failure",
      ],
    ])(
      "reports %s from the receipt",
      async (_, receiptStatus, logs, expected) => {
        hash(HASH);
        getTransactionReceipt.mockResolvedValue({
          status: receiptStatus,
          logs,
        });

        expect(await status()).toEqual({
          status: expected,
          transactionHash: HASH,
        });
      },
    );

    it("fails a call thirdweb dropped before sending it", async () => {
      rpc.set("tw_getTransactionHash", {
        isOk: true,
        data: {
          error: {
            code: -32000,
            message:
              "Transaction failed: TRANSACTION_SIMULATION_FAILED: Transaction reverted during gas estimation",
          },
        },
      });

      expect(await status()).toEqual({ status: "failure" });
    });

    it("throws instead of guessing when thirdweb doesn't know the call", async () => {
      rpc.set("tw_getTransactionHash", {
        isOk: false,
        statusCode: 400,
        data: {
          error: { code: -32602, message: "Transaction not found: q-1" },
        },
      });

      await expect(status()).rejects.toThrow("Transaction not found: q-1");
    });
  });

  describe("getSponsorshipError", () => {
    it("can sponsor when thirdweb serves the chain", async () => {
      expect(
        await thirdweb.getSponsorshipError("eip155:8453", signer, options),
      ).toBeNull();
      expect(http.create).toHaveBeenCalledWith(
        "https://8453.bundler.thirdweb.com/v2",
        expect.anything(),
      );
    });

    it.each([
      [
        "a plain error",
        {
          error:
            "Mainnets not enabled for this account, please enable billing to use mainnet paymaster services",
          code: 401,
        },
        "Mainnets not enabled for this account, please enable billing to use mainnet paymaster services",
      ],
      [
        "a JSON-RPC error",
        { error: { code: 400, message: "Invalid chain: 8453" } },
        "Invalid chain: 8453",
      ],
    ])("reports thirdweb's reason from %s", async (_, data, reason) => {
      rpc.set("tw_getDelegationContract", {
        isOk: false,
        statusCode: 401,
        data,
      });

      expect(
        await thirdweb.getSponsorshipError("eip155:8453", signer, options),
      ).toBe(reason);
    });
  });
});
