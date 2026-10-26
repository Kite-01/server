import { IMPLEMENTATION, USDC, ZERO, address } from "./factories";
import { getAddress, keccak256, toHex } from "viem";
import { deposit, quote, transfer } from "../db/schema";
import { operatorAddress } from "./mocks";
import { TransferStatus } from "../shared/constants";
import { kite } from "../shared/kiteContract";
import { db } from "../db";

export const payinFor = (id: string) => {
  return getAddress(`0x${keccak256(toHex(id)).slice(26)}`);
};

export const createQuoteRow = async (input: {
  appId: string;
  chainId: string;
  sourceTokenId: string;
  targetTokenId: string;
  sourceAmount?: bigint;
  targetAmount?: bigint;
  expiresAt?: Date;
  paymentLinkId?: string;
  targetUsdAmount?: string;
}) => {
  const [row] = await db
    .insert(quote)
    .values({
      appId: input.appId,
      chainId: input.chainId,
      sourceTokenId: input.sourceTokenId,
      targetTokenId: input.targetTokenId,
      paymentLinkId: input.paymentLinkId,
      sourceAmount: input.sourceAmount ?? 1_000_000n,
      targetAmount: input.targetAmount ?? input.sourceAmount ?? 1_000_000n,
      sourceUsdAmount: input.targetUsdAmount ?? "1",
      targetUsdAmount: input.targetUsdAmount ?? "1",
      rate: "1",
      expiresAt: input.expiresAt ?? new Date(Date.now() + 5 * 60 * 1000),
    })
    .returning();

  return row;
};

export const createTransferRow = async (input: {
  appId: string;
  quote: typeof quote.$inferSelect;
  tokenAddress?: string;
  settlementTokenAddress?: string;
  refundAddress?: string;
  status?: TransferStatus;
  x402Payer?: string | null;
  x402SettledAt?: Date | null;
  payinAddress?: string;
  createdAt?: Date;
}) => {
  const id = crypto.randomUUID();
  const refundAddress = input.refundAddress ?? address(0x7e7);
  const struct = kite.buildTransferInput({
    transferId: id,
    payInTokenAddress: input.tokenAddress ?? USDC,
    amountIn: input.quote.sourceAmount,
    settlementTokenAddress: input.settlementTokenAddress ?? USDC,
    settlementRecipient: operatorAddress,
    minAmountOut: input.quote.targetAmount,
    fees: [],
    refundAddress,
    expiresAt: input.quote.expiresAt,
    routerAddress: ZERO,
    poolFeeTier: 0,
    implementation: IMPLEMENTATION,
  });

  const [row] = await db
    .insert(transfer)
    .values({
      id,
      appId: input.appId,
      quoteId: input.quote.id,
      settlementRecipient: operatorAddress,
      minAmountOut: input.quote.targetAmount,
      refundAddress: struct.refundAddress,
      payinAddress: input.payinAddress ?? payinFor(id),
      kiteTransferInput: kite.serializeTransferInput(struct),
      status: input.status ?? TransferStatus.AwaitingDeposit,
      x402Payer: input.x402Payer ?? null,
      x402SettledAt: input.x402SettledAt ?? null,
      ...(input.createdAt ? { createdAt: input.createdAt } : {}),
    })
    .returning();

  return row;
};

export const createDepositRow = async (input: {
  address: string;
  chainId: string;
  tokenId: string;
  sender: string;
  amount: bigint;
  hash?: string;
  logIndex?: string;
}) => {
  const [row] = await db
    .insert(deposit)
    .values({
      address: input.address,
      chainId: input.chainId,
      tokenId: input.tokenId,
      senderAddress: getAddress(input.sender),
      amount: input.amount,
      blockchainHash:
        input.hash ?? `0x${crypto.randomUUID().replaceAll("-", "")}`,
      logIndex: input.logIndex ?? "0",
    })
    .returning();

  return row;
};
