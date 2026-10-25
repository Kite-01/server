import {
  type Address,
  type Hex,
  type PublicClient,
  BaseError,
  decodeErrorResult,
  decodeEventLog,
  encodeFunctionData,
  erc20Abi,
} from "viem";
import { KiteFactory__factory } from "@kite-01/contracts/typechain/factories/contracts/KiteFactory__factory.js";
import { Kite__factory } from "@kite-01/contracts/typechain/factories/contracts/Kite__factory.js";
import { KiteMaxFees } from "./constants";
import { AppError } from "./errors";
import { common } from "./common";

type Log = {
  address: string;
  topics: string[];
  data: string;
  logIndex: string;
  transactionHash: string;
};

type KiteFee = {
  id: Hex;
  recipient: Address;
  amount: bigint;
};

export type Kite_ITransfer = {
  id: Hex;
  payInTokenAddress: Address;
  amountIn: bigint;
  settlementTokenAddress: Address;
  settlementRecipient: Address;
  minAmountOut: bigint;
  fees: Array<KiteFee>;
  refundAddress: Address;
  expiresAt: bigint;
  routerAddress: Address;
  poolFeeTier: number;
  implementation: Address;
};

export type SerializedKite_ITransfer = Omit<
  Kite_ITransfer,
  "amountIn" | "minAmountOut" | "fees" | "expiresAt"
> & {
  amountIn: string;
  minAmountOut: string;
  expiresAt: string;
  fees: Array<{
    id: Hex;
    recipient: Address;
    amount: string;
  }>;
};

type CallErrorResponse =
  | { ok: false; kind: "transient"; message: string }
  | { ok: false; kind: "revert"; errorName: string; message: string };

class KiteContract {
  factory = {
    deploy: (t: Kite_ITransfer) => {
      return encodeFunctionData({
        abi: KiteFactory__factory.abi,
        functionName: "deploy",
        args: [t],
      });
    },
    settle: (t: Kite_ITransfer) => {
      return encodeFunctionData({
        abi: KiteFactory__factory.abi,
        functionName: "settle",
        args: [t],
      });
    },
    refund: (t: Kite_ITransfer) => {
      return encodeFunctionData({
        abi: KiteFactory__factory.abi,
        functionName: "refund",
        args: [t],
      });
    },
    recover: (t: Kite_ITransfer, token: string, destination: string) => {
      return encodeFunctionData({
        abi: KiteFactory__factory.abi,
        functionName: "recover",
        args: [
          t,
          common.normalizeAddress(token),
          common.normalizeAddress(destination),
        ],
      });
    },
  };

  serializeTransferInput = (t: Kite_ITransfer) => {
    return {
      ...t,
      amountIn: t.amountIn.toString(),
      minAmountOut: t.minAmountOut.toString(),
      expiresAt: t.expiresAt.toString(),
      fees: t.fees.map((f) => ({ ...f, amount: f.amount.toString() })),
    };
  };

  deserializeTransferInput = (t: SerializedKite_ITransfer) => {
    return {
      ...t,
      amountIn: BigInt(t.amountIn),
      minAmountOut: BigInt(t.minAmountOut),
      expiresAt: BigInt(t.expiresAt),
      fees: t.fees.map((f) => ({ ...f, amount: BigInt(f.amount) })),
    };
  };

  buildTransferInput = (input: {
    transferId: string;
    payInTokenAddress: string;
    amountIn: bigint;
    settlementTokenAddress: string;
    settlementRecipient: string;
    minAmountOut: bigint;
    fees: Array<{ id: string; recipient: string; amount: bigint }>;
    refundAddress: string;
    expiresAt: Date;
    routerAddress: string;
    poolFeeTier: number;
    implementation: string;
  }) => {
    return {
      id: common.uuidToBytes32(input.transferId),
      payInTokenAddress: common.normalizeAddress(input.payInTokenAddress),
      amountIn: input.amountIn,
      settlementTokenAddress: common.normalizeAddress(
        input.settlementTokenAddress,
      ),
      settlementRecipient: common.normalizeAddress(input.settlementRecipient),
      minAmountOut: input.minAmountOut,
      fees: [...input.fees]
        .sort((a, b) => a.id.localeCompare(b.id))
        .map((fee) => {
          return {
            id: common.uuidToBytes32(fee.id),
            recipient: common.normalizeAddress(fee.recipient),
            amount: fee.amount,
          };
        }),
      refundAddress: common.normalizeAddress(input.refundAddress),
      expiresAt: BigInt(Math.floor(input.expiresAt.getTime() / 1000)),
      routerAddress: common.normalizeAddress(input.routerAddress),
      poolFeeTier: input.poolFeeTier,
      implementation: common.normalizeAddress(input.implementation),
    };
  };

  validateTransferInput = (t: Kite_ITransfer) => {
    if (common.isZeroAddress(t.settlementRecipient)) {
      return "The settlement recipient cannot be the zero address";
    }

    if (common.isZeroAddress(t.refundAddress)) {
      return "The refund address cannot be the zero address";
    }

    if (t.fees.length > KiteMaxFees) {
      return `At most ${KiteMaxFees} fees can apply to a transfer (${t.fees.length} matched)`;
    }

    for (const fee of t.fees) {
      if (common.isZeroAddress(fee.recipient)) {
        return "A fee recipient cannot be the zero address";
      }

      if (fee.amount === 0n) {
        return "Every fee must be greater than zero";
      }
    }

    if (t.amountIn === 0n) {
      return "The amount must be greater than zero";
    }

    const totalFees = t.fees.reduce((total, fee) => total + fee.amount, 0n);
    if (t.minAmountOut < totalFees) {
      return `Fees amount exceed the minimum settlement amount`;
    }

    if (
      !common.isSameAddress(t.payInTokenAddress, t.settlementTokenAddress) &&
      common.isZeroAddress(t.routerAddress)
    ) {
      return "A swap router is required to settle in a different token";
    }

    return null;
  };

  predictAddress = async (
    client: PublicClient,
    factoryAddress: string,
    t: Kite_ITransfer,
  ) => {
    const error = this.validateTransferInput(t);
    if (error) throw new AppError(error);

    const address = await client.readContract({
      address: common.normalizeAddress(factoryAddress),
      abi: KiteFactory__factory.abi,
      functionName: "predictAddress",
      args: [t],
    });

    return common.normalizeAddress(address);
  };

  getImplementation = async (client: PublicClient, factoryAddress: string) => {
    const implementation = await client.readContract({
      address: common.normalizeAddress(factoryAddress),
      abi: KiteFactory__factory.abi,
      functionName: "implementation",
    });

    return common.normalizeAddress(implementation);
  };

  readStatus = async (client: PublicClient, cloneAddress: string) => {
    const code = await client.getCode({
      address: common.normalizeAddress(cloneAddress),
    });

    if (!code || code === "0x") {
      return null;
    }

    const status = await client.readContract({
      address: common.normalizeAddress(cloneAddress),
      abi: Kite__factory.abi,
      functionName: "status",
    });

    const list = [
      "Uninitialized",
      "Open",
      "Executing",
      "Settled",
      "Refunded",
    ] as const;

    return list[status];
  };

  classifyCallError = (error: unknown): CallErrorResponse => {
    if (!(error instanceof BaseError)) {
      return {
        ok: false,
        kind: "transient",
        message: error instanceof Error ? error.message : String(error),
      };
    }

    const reverted = error.walk(
      (e) =>
        e instanceof BaseError &&
        (e.name === "ExecutionRevertedError" ||
          e.name === "ContractFunctionRevertedError" ||
          e.name === "RawContractError" ||
          /execution reverted/i.test(e.details ?? "")),
    );

    const withData = error.walk(
      (e) =>
        typeof (e as { data?: unknown }).data === "string" &&
        /^0x[0-9a-fA-F]{8}/.test((e as { data: string }).data),
    ) as { data?: string } | null;

    if (!reverted && !withData) {
      return {
        ok: false,
        kind: "transient",
        message: error.shortMessage,
      };
    }

    const data = withData?.data as Hex | undefined;

    if (data) {
      try {
        const abi = [
          ...KiteFactory__factory.abi.filter((item) => item.type === "error"),
          ...Kite__factory.abi.filter((item) => item.type === "error"),
        ];

        const decoded = decodeErrorResult({
          abi,
          data,
        });

        return {
          ok: false,
          kind: "revert",
          errorName: decoded.errorName,
          message: error.shortMessage,
        };
      } catch {
        return {
          ok: false,
          kind: "revert",
          errorName: data.slice(0, 10),
          message: error.shortMessage,
        };
      }
    }

    return {
      ok: false,
      kind: "revert",
      errorName: "Unknown",
      message: error.shortMessage,
    };
  };

  simulateFactoryCall = async (
    client: PublicClient,
    factoryAddress: string,
    operatorAddress: string,
    data: Hex,
  ): Promise<
    | { ok: false; kind: "transient"; message: string }
    | { ok: false; kind: "revert"; errorName: string; message: string }
    | { ok: true }
  > => {
    try {
      await client.call({
        account: common.normalizeAddress(operatorAddress),
        to: common.normalizeAddress(factoryAddress),
        data,
      });

      return { ok: true };
    } catch (e) {
      return this.classifyCallError(e);
    }
  };

  parseErc20TransferLog = (log: Log) => {
    const [topic0, from, to] = log.topics;
    if (
      log.topics.length !== 3 ||
      topic0?.toLowerCase() !==
        common.eventTopicFromAbi(erc20Abi, "Transfer") ||
      !/^0x[0-9a-fA-F]{64}$/.test(log.data) ||
      !from ||
      !to
    ) {
      return null;
    }

    return {
      token: common.normalizeAddress(log.address),
      from: common.normalizeAddress(common.topicToAddress(from)),
      to: common.normalizeAddress(common.topicToAddress(to)),
      amount: BigInt(log.data),
    };
  };

  parseContractLogs = (caip2Id: Caip2Id, logs: readonly Log[]) => {
    const items: OnchainNotifierCallbackResult = [];
    const transfers = logs.map(this.parseErc20TransferLog);

    for (const log of logs) {
      let decoded;

      try {
        decoded = decodeEventLog({
          abi: Kite__factory.abi,
          topics: log.topics as [Hex, ...Hex[]],
          data: log.data as Hex,
        });
      } catch {
        continue;
      }

      const base = {
        caip2Id,
        blockchainHash: (log.transactionHash ?? "").toLowerCase(),
        logIndex: BigInt(log.logIndex ?? 0).toString(),
        payinAddress: common.normalizeAddress(log.address),
      };

      switch (decoded.eventName) {
        case "Settled":
          items.push({
            ...base,
            type: "Settled",
            transferId: decoded.args.transferId,
          });

          break;

        case "FeePaid":
          items.push({
            ...base,
            type: "FeePaid",
            transferId: decoded.args.transferId,
            feeId: decoded.args.feeId,
          });

          break;

        case "Refunded":
          items.push({
            ...base,
            type: "Refunded",
            transferId: decoded.args.transferId,
            amountRefunded: decoded.args.amountRefunded,
            refundAddress: common.normalizeAddress(decoded.args.refundAddress),
          });

          break;

        case "ExcessRefunded":
          items.push({
            ...base,
            type: "ExcessRefunded",
            transferId: decoded.args.transferId,
            tokenAddress: common.normalizeAddress(decoded.args.token),
            amount: decoded.args.amount,
            to: common.normalizeAddress(decoded.args.to),
          });

          break;

        case "Recovered": {
          const token = common.normalizeAddress(decoded.args.token);
          const sent = transfers.find(
            (t) =>
              !!t &&
              common.isSameAddress(t.token, token) &&
              common.isSameAddress(t.from, base.payinAddress) &&
              t.amount === decoded.args.amount,
          );

          items.push({
            ...base,
            type: "Recovered",
            transferId: decoded.args.transferId,
            tokenAddress: token,
            amount: decoded.args.amount,
            to: sent?.to ?? common.normalizeAddress(decoded.args.to),
          });

          break;
        }
      }
    }

    return items;
  };
}

export const kite = new KiteContract();
