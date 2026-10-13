import {
  decodeFunctionData,
  encodeFunctionResult,
  getAddress,
  parseAbi,
  type Hex,
} from "viem";
import { mnemonicToAccount } from "viem/accounts";
import { vi } from "vitest";

export const testMnemonic =
  "test test test test test test test test test test test junk";
export const operatorAddress = getAddress(
  mnemonicToAccount(testMnemonic).address,
);

export const schedulerMock = {
  enqueueEvent: vi.fn(async () => undefined),
  enqueueSettle: vi.fn(async () => undefined),
  enqueueRefund: vi.fn(async () => undefined),
  enqueueRecover: vi.fn(async () => undefined),
  enqueueForward: vi.fn(async () => undefined),
  send: vi.fn(async () => undefined),
};

const quoterAbi = parseAbi([
  "function quoteExactInputSingle((address tokenIn, address tokenOut, uint256 amountIn, uint24 fee, uint160 sqrtPriceLimitX96) params) external returns (uint256 amountOut, uint160 sqrtPriceX96After, uint32 initializedTicksCrossed, uint256 gasEstimate)",
  "function quoteExactOutputSingle((address tokenIn, address tokenOut, uint256 amount, uint24 fee, uint160 sqrtPriceLimitX96) params) external returns (uint256 amountIn, uint160 sqrtPriceX96After, uint32 initializedTicksCrossed, uint256 gasEstimate)",
]);

export const encodeQuoterResult = (
  functionName: "quoteExactInputSingle" | "quoteExactOutputSingle",
  amount: bigint,
) => {
  return encodeFunctionResult({
    abi: quoterAbi,
    functionName,
    result: [amount, 0n, 0, 0n],
  });
};

export const fakeActor = {
  getAddress: vi.fn(() => operatorAddress as string),
  publicClient: vi.fn(async (..._args: unknown[]): Promise<unknown> => {
    throw new Error("publicClient not stubbed");
  }),
  getBalance: vi.fn(async (..._args: unknown[]) => 0n),
  ethCall: vi.fn(async (..._args: unknown[]): Promise<string> => "0x"),
  sendTransaction: vi.fn(async (..._args: unknown[]) => "0xhash" as string),
  submitTransaction: vi.fn(async (..._args: unknown[]) => "call-1"),
  getTransactionStatus: vi.fn(
    async (..._args: unknown[]): Promise<unknown> => ({ status: "pending" }),
  ),
  waitForTransaction: vi.fn(async (..._args: unknown[]): Promise<unknown> => ({
    status: "pending",
  })),
  waitForReceipt: vi.fn(async (..._args: unknown[]): Promise<unknown> => ({
    logs: [],
  })),
  getConfirmations: vi.fn(async (..._args: unknown[]) => 1000n),
  getContractCode: vi.fn(async (..._args: unknown[]) => "0x"),
  getBlockNumber: vi.fn(async (..._args: unknown[]) => 1n),
  getGasPrice: vi.fn(async (..._args: unknown[]) => 1n),
};

export const resetMocks = () => {
  for (const fn of Object.values(schedulerMock)) fn.mockClear();
  for (const fn of Object.values(fakeActor)) fn.mockReset();

  fakeActor.getAddress.mockReturnValue(operatorAddress);
  fakeActor.getBalance.mockResolvedValue(0n);
  fakeActor.ethCall.mockResolvedValue("0x");
  fakeActor.sendTransaction.mockResolvedValue("0xhash");
  fakeActor.getTransactionStatus.mockResolvedValue({ status: "pending" });
  fakeActor.waitForReceipt.mockResolvedValue({ logs: [] });
  fakeActor.getConfirmations.mockResolvedValue(1000n);
};

type QuoterArgs = {
  tokenIn: string;
  tokenOut: string;
  fee: number;
  amount: bigint;
};

type QuoterFn = (args: QuoterArgs) => bigint | null;

export const stubQuoter = (handlers: {
  exactIn?: QuoterFn;
  exactOut?: QuoterFn;
}) => {
  fakeActor.ethCall.mockImplementation(async (...args: unknown[]) => {
    const decoded = decodeFunctionData({
      abi: quoterAbi,
      data: args[2] as Hex,
    });
    const params = decoded.args[0] as {
      tokenIn: string;
      tokenOut: string;
      fee: number;
      amountIn?: bigint;
      amount?: bigint;
    };

    const isExactIn = decoded.functionName === "quoteExactInputSingle";
    const handler = isExactIn ? handlers.exactIn : handlers.exactOut;
    const result = handler?.({
      tokenIn: getAddress(params.tokenIn),
      tokenOut: getAddress(params.tokenOut),
      fee: Number(params.fee),
      amount: (isExactIn ? params.amountIn : params.amount) as bigint,
    });

    if (result === null || result === undefined) {
      throw new Error("no pool");
    }

    return encodeQuoterResult(decoded.functionName, result);
  });
};
