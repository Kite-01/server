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
  enqueueUntrack: vi.fn(async () => undefined),
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
  getBlockTimestamp: vi.fn(async (..._args: unknown[]) => 0n),
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

type StubPair = {
  tokens: [string, string];
  // the pair's reserves of `tokens`, in order, from each block on
  reserves: Array<{
    fromBlock: bigint;
    amounts: [bigint, bigint];
  }>;
};

export const stubV2Pairs = (
  pairs: StubPair[],
  { latest = 10_000n, blockSeconds = 2n, oldestBlock = 0n } = {},
) => {
  const zero = getAddress(`0x${"0".repeat(40)}`);
  const timestampOf = (block: bigint) => 1_700_000_000n + block * blockSeconds;
  const byAddress = new Map(
    pairs.map((pair, index) => [
      getAddress(`0x${(0xd000 + index).toString(16).padStart(40, "0")}`),
      pair,
    ]),
  );

  const v2Abi = parseAbi([
    "function factory() external view returns (address)",
    "function getPool(address tokenA, address tokenB, uint24 fee) external view returns (address pool)",
    "function getPair(address tokenA, address tokenB) external view returns (address pair)",
    "function getReserves() external view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)",
    "function price0CumulativeLast() external view returns (uint256)",
    "function price1CumulativeLast() external view returns (uint256)",
  ]);

  // what the pair stores at `block`: its reserves, when it last traded and its price accumulators
  const stateAt = (pair: StubPair, block: bigint) => {
    const ordered = BigInt(pair.tokens[0]) < BigInt(pair.tokens[1]);
    const asToken0First = (amounts: [bigint, bigint]) =>
      ordered ? amounts : ([amounts[1], amounts[0]] as [bigint, bigint]);
    const segments = pair.reserves.filter((item) => item.fromBlock <= block);

    let price0 = 0n;
    let price1 = 0n;
    for (let i = 1; i < segments.length; i++) {
      const [reserve0, reserve1] = asToken0First(segments[i - 1].amounts);
      const elapsed =
        timestampOf(segments[i].fromBlock) -
        timestampOf(segments[i - 1].fromBlock);
      price0 += ((reserve1 << 112n) / reserve0) * elapsed;
      price1 += ((reserve0 << 112n) / reserve1) * elapsed;
    }

    const current = segments[segments.length - 1];
    const [reserve0, reserve1] = asToken0First(current.amounts);

    return {
      reserve0,
      reserve1,
      blockTimestampLast: Number(timestampOf(current.fromBlock) % (1n << 32n)),
      price0,
      price1,
    };
  };

  fakeActor.getBlockNumber.mockResolvedValue(latest);
  fakeActor.getBlockTimestamp.mockImplementation(async (...args: unknown[]) => {
    const block = args[1] as bigint;
    if (block < oldestBlock) throw new Error("missing trie node");
    return timestampOf(block);
  });

  fakeActor.ethCall.mockImplementation(async (...args: unknown[]) => {
    const to = getAddress(args[1] as string);
    const block = (args[3] as bigint | undefined) ?? latest;
    if (block < oldestBlock) throw new Error("missing trie node");

    const { functionName, args: params = [] } = decodeFunctionData({
      abi: v2Abi,
      data: args[2] as Hex,
    });

    const result = (value: unknown) =>
      encodeFunctionResult({
        abi: v2Abi,
        functionName,
        result: value,
      } as never);

    if (functionName === "factory") return result(uniswapFactory);
    if (functionName === "getPool") return result(zero);
    if (functionName === "getPair" && to === uniswapFactory) {
      const wanted = (params as [string, string])
        .map((token) => getAddress(token))
        .sort()
        .join();

      for (const [pairAddress, pair] of byAddress) {
        const tokens = pair.tokens
          .map((token) => getAddress(token))
          .sort()
          .join();
        if (tokens === wanted) return result(pairAddress);
      }

      return result(zero);
    }

    const pair = byAddress.get(to);
    if (!pair) throw new Error("execution reverted");

    const state = stateAt(pair, block);
    if (functionName === "getReserves")
      return result([state.reserve0, state.reserve1, state.blockTimestampLast]);
    if (functionName === "price0CumulativeLast") return result(state.price0);
    if (functionName === "price1CumulativeLast") return result(state.price1);

    throw new Error("execution reverted");
  });
};
