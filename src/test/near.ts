import { db } from "../db";
import { appChain, chain, chainConfig, quote, token } from "../db/schema";
import { kiteNear, type NearKiteTransfer } from "../shared/kiteNearContract";
import { createApp } from "./factories";
import { fakeNearActor } from "./mocks";
import { env } from "../shared/env";

export const NEAR_CAIP2 = "near:testnet" as Caip2Id;
export const NEAR_FACTORY = "kite-factory.near";
export const NEAR_USDC = "usdc.near";
export const NEAR_IMPLEMENTATION =
  "4reLvkAWfqk5fsqio1KLudk46cqRz9erQdaHkWZKMJDZ";
export const NEAR_SHOP = "shop.near";

export const setupNearChain = async () => {
  env.KITE_IS_TESTNET = true;

  const appId = (await createApp()).id;
  const [row] = await db
    .insert(chain)
    .values({ caip2Id: NEAR_CAIP2 })
    .returning();
  const chainId = row.id;

  const [usdc] = await db
    .insert(token)
    .values({
      chainId,
      address: NEAR_USDC,
      symbol: "USDC",
      name: "USD Coin",
      decimals: 6,
      listed: true,
    })
    .returning();

  const [near] = await db
    .insert(token)
    .values({
      chainId,
      address: "near",
      symbol: "NEAR",
      name: "NEAR",
      decimals: 24,
      listed: true,
    })
    .returning();

  await db.insert(chainConfig).values({
    chainId,
    slippageBps: 100,
    kiteFactoryAddress: NEAR_FACTORY,
    usdPeggedTokenId: usdc.id,
    settlementTokenId: usdc.id,
    onchainNotifierProviders: [],
    gasSponsorProviders: [],
  });

  await db.insert(appChain).values({ appId, chainId, address: NEAR_SHOP });

  fakeNearActor.view.mockImplementation(async (...args: unknown[]) => {
    const [, contractId, method, params] = args as [
      Caip2Id,
      string,
      string,
      { transfer?: NearKiteTransfer; account_id?: string },
    ];
    if (contractId === NEAR_FACTORY && method === "implementation")
      return NEAR_IMPLEMENTATION;
    if (contractId === NEAR_FACTORY && method === "predict_address")
      return kiteNear.predictAddress(NEAR_FACTORY, params.transfer!);
    if (contractId === NEAR_FACTORY && method === "deploy_deposit")
      return "6000000000000000000000";
    if (method === "get_status") return "Open";
    if (method === "get_progress") return { wrapped: false };
    if (method === "storage_balance_of")
      return params.account_id === NEAR_SHOP
        ? null
        : { total: "1", available: "0" };
    if (method === "storage_balance_bounds")
      return { min: "1250000000000000000000" };
    throw new Error(`unexpected view ${contractId}.${method}`);
  });

  fakeNearActor.getAccount.mockResolvedValue(nearDeployedAccount());

  return { appId, chainId, usdcId: usdc.id, nearId: near.id };
};

export const nearDeployedAccount = (amount = 0n, storageUsage = 434) => ({
  amount,
  storageUsage,
  contract: NEAR_IMPLEMENTATION as string | null,
});

export const createNearQuoteRow = async (input: {
  appId: string;
  chainId: string;
  sourceTokenId: string;
  targetTokenId: string;
  sourceAmount?: bigint;
  targetAmount?: bigint;
}) => {
  const [row] = await db
    .insert(quote)
    .values({
      appId: input.appId,
      chainId: input.chainId,
      sourceTokenId: input.sourceTokenId,
      targetTokenId: input.targetTokenId,
      sourceAmount: input.sourceAmount ?? 1_000_000n,
      targetAmount: input.targetAmount ?? input.sourceAmount ?? 1_000_000n,
      sourceUsdAmount: "1",
      targetUsdAmount: "1",
      rate: "1",
      expiresAt: new Date(Date.now() + 5 * 60 * 1000),
    })
    .returning();

  return row;
};

export const nearOutcome = (
  receipts: Array<{ logs: string[]; executor?: string }>,
  status: "success" | "failure" = "success",
) => ({
  status,
  transactionHash: "TxHash111",
  failure: status === "failure" ? "{}" : undefined,
  outcome: {
    transaction_outcome: { id: "TxHash111" },
    receipts_outcome: receipts.map((r, i) => ({
      id: `r${i}`,
      outcome: { logs: r.logs, executor_id: r.executor ?? NEAR_FACTORY },
    })),
  },
});

export const nearEvent = (name: string, data: Record<string, unknown>) =>
  `EVENT_JSON:${JSON.stringify({ standard: "kite", version: "1.0.0", event: name, data })}`;
