import {
  KiteMaxFees,
  QuoteTTLSeconds,
  UniswapFeeTiers,
} from "../shared/constants";
import { AppError, NotFoundError } from "../shared/errors";
import { formatUnits, parseUnits } from "viem";
import { and, eq, desc, isNull } from "drizzle-orm";
import { quote, quoteFee, fee } from "../db/schema";
import { PaymentLinkService } from "./PaymentLink.service";
import { PriceFeedService } from "./PriceFeed.service";
import { getOnchainActor } from "../shared/onchainActor";
import { CustomerService } from "./Customer.service";
import { TokenService } from "./Token.service";
import { ChainService } from "./Chain.service";
import { FeeService } from "./Fee.service";
import { getChain } from "../shared/chains";
import { Uniswap } from "../sdks/Uniswap";
import { common } from "../shared/common";
import { db } from "../db";

type QuoteBase = {
  chainId: string;
  sourceTokenAddress: string;
  customerId?: string;
  reference?: string;
  meta?: Record<string, unknown>;
};

export class QuoteService {
  private formatRate = (
    source: { amount: bigint; decimals: number },
    target: { amount: bigint; decimals: number },
  ) => {
    return formatUnits(
      common.ceilDiv(
        target.amount * common.pow10(source.decimals + 18),
        source.amount * common.pow10(target.decimals),
      ),
      18,
    );
  };

  private quoteFees = (
    fees: (typeof fee.$inferSelect)[],
    targetAmount: bigint,
    slippageBps: number,
    operatorAddress: string,
    settlementAddress: Maybe<string>,
  ) => {
    const fees_ = fees
      .map((f) => ({
        fee: f,
        amount: new FeeService().computeFeeAmount(f, targetAmount),
        feeAddress: common.normalizeAddress(
          f.feeAddress ?? settlementAddress ?? operatorAddress,
        ),
      }))
      .filter(
        (item) => item.amount > 0n && !common.isZeroAddress(item.feeAddress),
      );

    if (fees_.length > KiteMaxFees) {
      throw new AppError("Too many fees");
    }

    const totalFees = fees_.reduce((total, { amount }) => total + amount, 0n);
    const minAmountOut =
      (targetAmount * (10000n - BigInt(slippageBps))) / 10000n;

    if (totalFees > minAmountOut) {
      throw new AppError("Fees exceed the amount this payment settles for");
    }

    return fees_;
  };

  private insertQuote = async (input: {
    quote: typeof quote.$inferInsert;
    fees: ReturnType<QuoteService["quoteFees"]>;
  }) => {
    return db.transaction(async (transaction) => {
      const [q] = await transaction
        .insert(quote)
        .values(input.quote)
        .returning();

      if (input.fees.length) {
        await transaction.insert(quoteFee).values(
          input.fees.map((item) => ({
            quoteId: q.id,
            feeId: item.fee.id,
            label: item.fee.label,
            amount: item.amount,
            feeAddress: item.feeAddress,
          })),
        );
      }

      return q;
    });
  };

  createQuote = async (
    appId: string,
    input: QuoteBase & { amount: bigint },
  ) => {
    const chain = await new ChainService().getChainById(input.chainId);
    if (!chain) throw new NotFoundError("chain", input.chainId);
    if (!chain.config)
      throw new AppError("Selected chain is yet to be configured");

    const settlementToken = chain.config.settlementToken;
    const chainUsdToken = chain.config.usdPeggedToken;
    const sourceToken = await new TokenService().getTokenByAddress(
      chain.id,
      input.sourceTokenAddress,
    );

    const sourceAmount = input.amount;
    if (sourceAmount <= 0n)
      throw new AppError("Amount must be greater than zero");

    let targetAmount: bigint;
    let feeTier: Maybe<number> = null;

    if (settlementToken.id === sourceToken.id) {
      targetAmount = sourceAmount;
    } else {
      const uniswap = new Uniswap();
      const results = await Promise.all(
        UniswapFeeTiers.map(async (feeTier) => ({
          feeTier,
          amountOut: await uniswap.quoteExactInputSingle({
            caip2Id: chain.caip2Id,
            tokenIn: sourceToken.address,
            amountIn: sourceAmount,
            tokenOut: settlementToken.address,
            feeTier,
          }),
        })),
      );

      let best: Maybe<{
        feeTier: number;
        amountOut: bigint;
      }> = null;

      for (const result of results) {
        if (
          result.amountOut !== null &&
          result.amountOut > 0n &&
          (!best || result.amountOut > best.amountOut)
        ) {
          best = {
            feeTier: result.feeTier,
            amountOut: result.amountOut,
          };
        }
      }

      if (!best)
        throw new AppError("No pool can swap this token/amount at the moment");

      targetAmount = best.amountOut;
      feeTier = best.feeTier;
    }

    let sourceUsdAmount: string;
    let targetUsdAmount: string;

    if (sourceToken.id === chainUsdToken.id) {
      sourceUsdAmount = formatUnits(sourceAmount, sourceToken.decimals);
      targetUsdAmount =
        settlementToken.id === chainUsdToken.id
          ? formatUnits(targetAmount, settlementToken.decimals)
          : sourceUsdAmount;
    } else if (settlementToken.id === chainUsdToken.id) {
      targetUsdAmount = formatUnits(targetAmount, settlementToken.decimals);
      sourceUsdAmount = targetUsdAmount;
    } else {
      const uniswap = new Uniswap();
      const usdResults = await Promise.all(
        UniswapFeeTiers.map((tier) =>
          uniswap.quoteExactInputSingle({
            caip2Id: chain.caip2Id,
            tokenIn: sourceToken.address,
            amountIn: sourceAmount,
            tokenOut: chainUsdToken.address,
            feeTier: tier,
          }),
        ),
      );

      let bestUsdOut: Maybe<bigint> = null;
      for (const out of usdResults) {
        if (out !== null && out > 0n && (!bestUsdOut || out > bestUsdOut)) {
          bestUsdOut = out;
        }
      }

      if (!bestUsdOut)
        throw new AppError("Unable to determine USD value at the moment");

      sourceUsdAmount = formatUnits(bestUsdOut, chainUsdToken.decimals);
      targetUsdAmount = sourceUsdAmount;
    }

    const customer = input.customerId
      ? await new CustomerService().getCustomerById(appId, input.customerId)
      : null;

    const matchingFees = await new FeeService().getMatchingFees(
      appId,
      chain.id,
      { customer, sourceAmount, sourceToken, targetToken: settlementToken },
    );

    return this.insertQuote({
      fees: this.quoteFees(
        matchingFees,
        targetAmount,
        chain.config.slippageBps,
        getOnchainActor(getChain(chain.caip2Id).type).getAddress(),
        chain.config.settlementAddress,
      ),
      quote: {
        appId,
        customerId: customer?.id,
        chainId: chain.id,
        sourceTokenId: sourceToken.id,
        targetTokenId: settlementToken.id,
        sourceAmount,
        sourceUsdAmount,
        targetAmount,
        targetUsdAmount,
        rate: this.formatRate(
          { amount: sourceAmount, decimals: sourceToken.decimals },
          { amount: targetAmount, decimals: settlementToken.decimals },
        ),
        uniswapPoolFeeTier: feeTier,
        reference: input.reference,
        meta: input.meta,
        expiresAt: new Date(Date.now() + common.toMs(QuoteTTLSeconds)),
      },
    });
  };

  createQuoteFromPaymentLink = async (
    appId: string,
    paymentLinkId: string,
    input: QuoteBase,
  ) => {
    const paymentLink = await new PaymentLinkService().getPaymentLink(
      appId,
      paymentLinkId,
    );

    if (!paymentLink) {
      throw new NotFoundError("paymentLink", paymentLinkId);
    }

    const chain = await new ChainService().getChainById(input.chainId);
    if (!chain) throw new NotFoundError("chain", input.chainId);
    if (!chain.config)
      throw new AppError("Selected chain is yet to be configured");

    const settlementToken = chain.config.settlementToken;
    const chainUsdToken = chain.config.usdPeggedToken;
    const sourceToken = await new TokenService().getTokenByAddress(
      chain.id,
      input.sourceTokenAddress,
    );

    const currency = paymentLink.currency.toUpperCase();
    const fxPrice =
      currency === "USD"
        ? { answer: 1n, decimals: 0 }
        : await new PriceFeedService().getPrice(currency, "USD");

    const AmountDecimals = 8;

    const amountScaled = parseUnits(paymentLink.amount, AmountDecimals);
    const usdTokenAmount = common.ceilDiv(
      amountScaled * fxPrice.answer * common.pow10(chainUsdToken.decimals),
      common.pow10(AmountDecimals + fxPrice.decimals),
    );

    const uniswap = new Uniswap();

    let targetAmount: bigint;

    if (settlementToken.id === chainUsdToken.id) {
      targetAmount = usdTokenAmount;
    } else {
      const results = await Promise.all(
        UniswapFeeTiers.map(async (feeTier) => ({
          feeTier,
          amountOut: await uniswap.quoteExactInputSingle({
            caip2Id: chain.caip2Id,
            tokenIn: chainUsdToken.address,
            amountIn: usdTokenAmount,
            tokenOut: settlementToken.address,
            feeTier,
          }),
        })),
      );

      let bestAmountOut: Maybe<bigint> = null;

      for (const result of results) {
        if (
          result.amountOut !== null &&
          result.amountOut > 0n &&
          (!bestAmountOut || result.amountOut > bestAmountOut)
        ) {
          bestAmountOut = result.amountOut;
        }
      }

      if (!bestAmountOut)
        throw new AppError("Settlement token cannot be priced at the moment");

      targetAmount = bestAmountOut;
    }

    if (targetAmount <= 0n)
      throw new AppError("Destination amount cannot be zero");

    let sourceAmount: bigint;
    let feeTier: number | null = null;

    if (sourceToken.id === settlementToken.id) {
      sourceAmount = targetAmount;
    } else {
      const results = await Promise.all(
        UniswapFeeTiers.map(async (feeTier) => ({
          feeTier,
          amountIn: await uniswap.quoteExactOutputSingle({
            caip2Id: chain.caip2Id,
            tokenIn: sourceToken.address,
            amountOut: targetAmount,
            tokenOut: settlementToken.address,
            feeTier,
          }),
        })),
      );

      let best: Maybe<{
        feeTier: number;
        amountIn: bigint;
      }> = null;

      for (const result of results) {
        if (
          result.amountIn !== null &&
          result.amountIn > 0n &&
          (!best || result.amountIn < best.amountIn)
        ) {
          best = {
            amountIn: result.amountIn,
            feeTier: result.feeTier,
          };
        }
      }

      if (!best)
        throw new AppError("No pool can satisfy this payment amount/token");

      sourceAmount = best.amountIn;
      feeTier = best.feeTier;
    }

    const targetUsdAmount = formatUnits(usdTokenAmount, chainUsdToken.decimals);
    const sourceUsdAmount = targetUsdAmount;

    const customer = input.customerId
      ? await new CustomerService().getCustomerById(appId, input.customerId)
      : null;

    const matchingFees = await new FeeService().getMatchingFees(
      appId,
      chain.id,
      {
        customer,
        sourceAmount,
        sourceToken,
        targetToken: settlementToken,
      },
    );

    return this.insertQuote({
      fees: this.quoteFees(
        matchingFees,
        targetAmount,
        chain.config.slippageBps,
        getOnchainActor(getChain(chain.caip2Id).type).getAddress(),
        chain.config.settlementAddress,
      ),
      quote: {
        appId,
        paymentLinkId,
        customerId: customer?.id,
        chainId: chain.id,
        sourceTokenId: sourceToken.id,
        targetTokenId: settlementToken.id,
        sourceAmount,
        sourceUsdAmount,
        targetAmount,
        targetUsdAmount,
        rate: this.formatRate(
          { amount: sourceAmount, decimals: sourceToken.decimals },
          { amount: targetAmount, decimals: settlementToken.decimals },
        ),
        uniswapPoolFeeTier: feeTier,
        reference: input.reference,
        meta: input.meta,
        expiresAt: new Date(Date.now() + common.toMs(QuoteTTLSeconds)),
      },
    });
  };

  addQuoteFeeReceipt = async (feeId: string, blockchainHash: string) => {
    await db
      .update(quoteFee)
      .set({ blockchainHash })
      .where(and(eq(quoteFee.id, feeId), isNull(quoteFee.blockchainHash)));
  };

  getQuotes = async (appId: string) => {
    return db.query.quote.findMany({
      where: eq(quote.appId, appId),
      orderBy: desc(quote.createdAt),
      with: {
        customer: true,
        paymentLink: true,
        chain: true,
        sourceToken: true,
        targetToken: true,
        fees: true,
      },
    });
  };

  getQuote = async (appId: string, quoteId: string) => {
    return db.query.quote.findFirst({
      where: and(eq(quote.appId, appId), eq(quote.id, quoteId)),
      with: {
        customer: true,
        paymentLink: true,
        chain: true,
        sourceToken: true,
        targetToken: true,
        fees: true,
      },
    });
  };
}
