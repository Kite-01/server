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
  getSponsorshipError: vi.fn(
    async (..._args: unknown[]): Promise<string | null> => null,
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

export const uniswapFactory = getAddress(`0x${"f".repeat(38)}01`);

type StubPool = {
  tokens: [string, string];
  fee: number;
  tick: number;
  liquidity?: bigint;
  history?: number;
};

export const stubPools = (pools: StubPool[]) => {
  const byAddress = new Map(
    pools.map((pool, index) => [
      getAddress(`0x${(0xe000 + index).toString(16).padStart(40, "0")}`),
      pool,
    ]),
  );

  const uniswapAbi = parseAbi([
    "function factory() external view returns (address)",
    "function getPool(address tokenA, address tokenB, uint24 fee) external view returns (address pool)",
    "function liquidity() external view returns (uint128)",
    "function observe(uint32[] secondsAgos) external view returns (int56[] tickCumulatives, uint160[] secondsPerLiquidityCumulativeX128s)",
  ]);

  fakeActor.ethCall.mockImplementation(async (...args: unknown[]) => {
    const to = getAddress(args[1] as string);
    const data = args[2] as Hex;
    const { functionName, args: params = [] } = decodeFunctionData({
      abi: uniswapAbi,
      data,
    });

    const result = (value: unknown) =>
      encodeFunctionResult({
        abi: uniswapAbi,
        functionName,
        result: value,
      } as never);

    if (functionName === "factory") return result(uniswapFactory);
    if (functionName === "getPool" && to === uniswapFactory) {
      const [tokenA, tokenB, fee] = params as [string, string, number];
      const pair = [getAddress(tokenA), getAddress(tokenB)].sort().join();
      for (const [poolAddress, pool] of byAddress) {
        const tokens = pool.tokens
          .map((t) => getAddress(t))
          .sort()
          .join();
        if (tokens === pair && pool.fee === fee) return result(poolAddress);
      }

      return result(getAddress(`0x${"0".repeat(40)}`));
    }

    const pool = byAddress.get(to);
    if (!pool) {
      throw new Error("execution reverted");
    }

    if (functionName === "liquidity") {
      return result(pool.liquidity ?? 10n ** 18n);
    }

    if (functionName === "observe") {
      const [[window]] = params as [readonly number[]];
      if (window > (pool.history ?? Infinity)) {
        throw new Error("OLD");
      }

      return result([
        [0n, BigInt(pool.tick) * BigInt(window)],
        [0n, 0n],
      ]);
    }

    throw new Error("execution reverted");
  });
};
