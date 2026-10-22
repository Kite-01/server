import { getAddress } from "viem";
import { db } from "../db";
import {
  apiKey,
  app,
  chain,
  chainConfig,
  customer,
  fee,
  paymentLink,
  token,
} from "../db/schema";
import { FeeType, Provider } from "../shared/constants";
import { signing } from "../shared/signing";

let sequence = 0;

export const nextId = () => {
  return `${Date.now().toString(36)}${(sequence++).toString(36)}`;
};

export const address = (n: number) => {
  return getAddress(`0x${n.toString(16).padStart(40, "0")}`);
};

export const FACTORY = address(0xfac);
export const USDC = address(0xa11ce);
export const WETH = address(0xb0b);
export const ZERO = address(0);

export const createApp = async (
  values: Partial<typeof app.$inferInsert> = {},
) => {
  const [row] = await db
    .insert(app)
    .values({ name: `App ${nextId()}`, ...values })
    .returning();

  return row;
};

export const createChain = async (caip2Id: Caip2Id = "eip155:8453") => {
  const [row] = await db.insert(chain).values({ caip2Id }).returning();
  return row;
};

export const createToken = async (
  chainId: string,
  values: Partial<typeof token.$inferInsert> = {},
) => {
  const [row] = await db
    .insert(token)
    .values({
      chainId,
      address: address(Math.floor(Math.random() * 1e12)),
      symbol: "TKN",
      decimals: 18,
      name: "Token",
      listed: true,
      ...values,
    })
    .returning();

  return row;
};

export const createConfiguredChain = async (
  caip2Id: Caip2Id = "eip155:8453",
) => {
  const row = await createChain(caip2Id);
  const usdc = await createToken(row.id, {
    address: USDC,
    symbol: "USDC",
    name: "USD Coin",
    decimals: 6,
    version: "2",
    supportsEIP3009: true,
  });

  const [config] = await db
    .insert(chainConfig)
    .values({
      chainId: row.id,
      slippageBps: 100,
      kiteFactoryAddress: FACTORY,
      usdPeggedTokenId: usdc.id,
      settlementTokenId: usdc.id,
      onchainNotifierProviders: [Provider.QuickNode],
      gasSponsorProviders: [Provider.Alchemy],
    })
    .returning();

  return { chain: row, usdc, config };
};

export const createCustomer = async (
  appId: string,
  values: Partial<typeof customer.$inferInsert> = {},
) => {
  const [row] = await db
    .insert(customer)
    .values({ appId, externalId: `ext-${nextId()}`, ...values })
    .returning();

  return row;
};

export const createFee = async (
  chainId: string,
  values: Partial<typeof fee.$inferInsert> = {},
) => {
  const [row] = await db
    .insert(fee)
    .values({
      chainId,
      label: "Fee",
      type: FeeType.Fixed,
      value: 0n,
      condition: {},
      ...values,
    })
    .returning();

  return row;
};

export const createPaymentLink = async (
  appId: string,
  values: Partial<typeof paymentLink.$inferInsert> = {},
) => {
  const [row] = await db
    .insert(paymentLink)
    .values({
      appId,
      title: "Link",
      currency: "USD",
      amount: "10",
      ...values,
    })
    .returning();

  return row;
};

export const createApiKey = async (
  appId: string,
  values: Partial<typeof apiKey.$inferInsert> = {},
) => {
  const pair = signing.generateKeyPair();
  const [row] = await db
    .insert(apiKey)
    .values({
      appId,
      label: "test key",
      publicKey: pair.publicKey,
      scopes: [],
      ...values,
    })
    .returning();

  return {
    row,
    publicKey: pair.publicKey,
    credentials: {
      keyId: row.id,
      privateKey: pair.privateKey,
    },
  };
};
