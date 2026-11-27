import {
  decodeFunctionData,
  encodeFunctionResult,
  getAddress,
  parseAbi,
  type Hex,
} from "viem";
import { mnemonicToAccount } from "viem/accounts";
import { vi } from "vitest";
import { stellarKeypair } from "../shared/stellarAddress";
import { gnoKey } from "../shared/gnoAddress";

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
  enqueueCheckPayout: vi.fn(async () => undefined),
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

export const nearOperator = "a".repeat(64);

export const fakeNearActor = {
  getAddress: vi.fn(() => nearOperator),
  getPublicKey: vi.fn(() => "ed25519:11111111111111111111111111111111"),
  getBalance: vi.fn(async (..._args: unknown[]) => 0n),
  view: vi.fn(async (..._args: unknown[]): Promise<unknown> => {
    throw new Error("view not stubbed");
  }),
  accountExists: vi.fn(async (..._args: unknown[]) => true),
  getAccount: vi.fn(
    async (
      ..._args: unknown[]
    ): Promise<{
      amount: bigint;
      storageUsage: number;
      contract: string | null;
    } | null> => null,
  ),
  viewAccessKey: vi.fn(
    async (..._args: unknown[]): Promise<{ nonce: bigint } | null> => ({
      nonce: 0n,
    }),
  ),
  functionCall: vi.fn(async (..._args: unknown[]): Promise<unknown> => {
    throw new Error("functionCall not stubbed");
  }),
  transferNear: vi.fn(async (..._args: unknown[]): Promise<unknown> => {
    throw new Error("transferNear not stubbed");
  }),
  getOutcome: vi.fn(async (..._args: unknown[]): Promise<unknown> => {
    throw new Error("getOutcome not stubbed");
  }),
  getTransactionStatus: vi.fn(
    async (..._args: unknown[]): Promise<unknown> => ({ status: "pending" }),
  ),
  getConfirmations: vi.fn(async (..._args: unknown[]) => 1n),
  getBlockNumber: vi.fn(async (..._args: unknown[]) => 1n),
  getSponsorshipError: vi.fn(
    async (..._args: unknown[]): Promise<string | null> =>
      "Gas sponsors aren't available on NEAR; the operator pays gas",
  ),
};

export const stellarOperator = stellarKeypair(testMnemonic, 0).publicKey();

export const fakeStellarActor = {
  getAddress: vi.fn(() => stellarOperator),
  keypair: vi.fn((index = 0) => stellarKeypair(testMnemonic, index)),
  passphrase: vi.fn(
    (..._args: unknown[]) => "Test SDF Network ; September 2015",
  ),
  getBalance: vi.fn(async (..._args: unknown[]) => 0n),
  simulate: vi.fn(async (..._args: unknown[]): Promise<unknown> => {
    throw new Error("simulate not stubbed");
  }),
  view: vi.fn(async (..._args: unknown[]): Promise<unknown> => {
    throw new Error("view not stubbed");
  }),
  invoke: vi.fn(async (..._args: unknown[]): Promise<unknown> => {
    throw new Error("invoke not stubbed");
  }),
  isSac: vi.fn(async (..._args: unknown[]) => true),
  trust: vi.fn(async (..._args: unknown[]) => undefined),
  canHold: vi.fn(async (..._args: unknown[]) => true),
  receivable: vi.fn(
    async (..._args: unknown[]): Promise<"ok" | "unfunded" | "untrusted"> =>
      "ok",
  ),
  getTransactionStatus: vi.fn(
    async (..._args: unknown[]): Promise<unknown> => ({ status: "pending" }),
  ),
  getConfirmations: vi.fn(async (..._args: unknown[]) => 1n),
  getBlockNumber: vi.fn(async (..._args: unknown[]) => 1000n),
  getSponsorshipError: vi.fn(
    async (..._args: unknown[]): Promise<string | null> =>
      "Gas sponsors aren't available on Stellar; the operator pays fees",
  ),
};

export const gnoOperator = gnoKey(testMnemonic, 0).address;

export const fakeGnoActor = {
  getAddress: vi.fn(() => gnoOperator),
  getBalance: vi.fn(async (..._args: unknown[]) => 0n),
  evaluate: vi.fn(async (..._args: unknown[]): Promise<string> => {
    throw new Error("evaluate not stubbed");
  }),
  qeval: vi.fn(async (..._args: unknown[]): Promise<string> => {
    throw new Error("qeval not stubbed");
  }),
  provider: vi.fn(async (..._args: unknown[]): Promise<unknown> => {
    throw new Error("provider not stubbed");
  }),
  call: vi.fn(async (..._args: unknown[]): Promise<unknown> => {
    throw new Error("call not stubbed");
  }),
  send: vi.fn(async (..._args: unknown[]): Promise<string> => {
    throw new Error("send not stubbed");
  }),
  getTokenMetadata: vi.fn(async (..._args: unknown[]): Promise<unknown> => {
    throw new Error("getTokenMetadata not stubbed");
  }),
  getTransactionStatus: vi.fn(
    async (..._args: unknown[]): Promise<unknown> => ({ status: "pending" }),
  ),
  getConfirmations: vi.fn(async (..._args: unknown[]) => 1n),
  getBlockNumber: vi.fn(async (..._args: unknown[]) => 1000n),
  getSponsorshipError: vi.fn(
    async (..._args: unknown[]): Promise<string | null> =>
      "Gas sponsors aren't available on Gno; the operator pays fees",
  ),
};

export const nearIntentsMock = {
  getTokens: vi.fn(async (..._args: unknown[]): Promise<unknown[]> => []),
  getAssetId: vi.fn(
    async (..._args: unknown[]): Promise<string | null> => null,
  ),
  quote: vi.fn(async (..._args: unknown[]): Promise<unknown> => {
    throw new Error("quote not stubbed");
  }),
  getStatus: vi.fn(async (..._args: unknown[]): Promise<unknown> => {
    throw new Error("getStatus not stubbed");
  }),
};

export const resetMocks = () => {
  for (const fn of Object.values(schedulerMock)) fn.mockClear();
  for (const fn of Object.values(nearIntentsMock)) fn.mockReset();
  nearIntentsMock.getTokens.mockResolvedValue([]);
  nearIntentsMock.getAssetId.mockResolvedValue(null);
  nearIntentsMock.quote.mockRejectedValue(new Error("quote not stubbed"));
  nearIntentsMock.getStatus.mockRejectedValue(
    new Error("getStatus not stubbed"),
  );
  for (const fn of Object.values(fakeActor)) fn.mockReset();
  for (const fn of Object.values(fakeNearActor)) fn.mockReset();
  fakeNearActor.getAddress.mockReturnValue(nearOperator);
  fakeNearActor.getBalance.mockResolvedValue(0n);
  fakeNearActor.accountExists.mockResolvedValue(true);
  fakeNearActor.viewAccessKey.mockResolvedValue({ nonce: 0n });
  fakeNearActor.getAccount.mockResolvedValue(null);
  fakeNearActor.getBlockNumber.mockResolvedValue(1000n);
  fakeNearActor.getConfirmations.mockResolvedValue(1n);
  fakeNearActor.view.mockRejectedValue(new Error("view not stubbed"));
  fakeNearActor.functionCall.mockRejectedValue(
    new Error("functionCall not stubbed"),
  );

  for (const fn of Object.values(fakeStellarActor)) fn.mockReset();
  fakeStellarActor.getAddress.mockReturnValue(stellarOperator);
  fakeStellarActor.keypair.mockImplementation((index = 0) =>
    stellarKeypair(testMnemonic, index),
  );
  fakeStellarActor.passphrase.mockReturnValue(
    "Test SDF Network ; September 2015",
  );
  fakeStellarActor.getBalance.mockResolvedValue(0n);
  fakeStellarActor.isSac.mockResolvedValue(true);
  fakeStellarActor.canHold.mockResolvedValue(true);
  fakeStellarActor.receivable.mockResolvedValue("ok");
  fakeStellarActor.getBlockNumber.mockResolvedValue(1000n);
  fakeStellarActor.getConfirmations.mockResolvedValue(1n);
  fakeStellarActor.getTransactionStatus.mockResolvedValue({
    status: "pending",
  });
  fakeStellarActor.simulate.mockRejectedValue(
    new Error("simulate not stubbed"),
  );
  fakeStellarActor.view.mockRejectedValue(new Error("view not stubbed"));
  fakeStellarActor.invoke.mockRejectedValue(new Error("invoke not stubbed"));

  for (const fn of Object.values(fakeGnoActor)) fn.mockReset();
  fakeGnoActor.getAddress.mockReturnValue(gnoOperator);
  fakeGnoActor.getBalance.mockResolvedValue(0n);
  fakeGnoActor.getBlockNumber.mockResolvedValue(1000n);
  fakeGnoActor.getConfirmations.mockResolvedValue(1n);
  fakeGnoActor.getTransactionStatus.mockResolvedValue({ status: "pending" });
  fakeGnoActor.evaluate.mockRejectedValue(new Error("evaluate not stubbed"));
  fakeGnoActor.qeval.mockRejectedValue(new Error("qeval not stubbed"));
  fakeGnoActor.provider.mockRejectedValue(new Error("provider not stubbed"));
  fakeGnoActor.call.mockRejectedValue(new Error("call not stubbed"));
  fakeGnoActor.send.mockRejectedValue(new Error("send not stubbed"));
  fakeGnoActor.getTokenMetadata.mockRejectedValue(
    new Error("getTokenMetadata not stubbed"),
  );

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
