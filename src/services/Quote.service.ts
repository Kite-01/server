import {
  paginate,
  searchPattern,
  type WithPageInput,
} from "../shared/pagination";
import { and, eq, desc, isNull, count, ilike, or, sql } from "drizzle-orm";
import { KiteMaxFees, QuoteTTLSeconds } from "../shared/constants";
import { AppError, NotFoundError } from "../shared/errors";
import { formatUnits, parseUnits } from "viem";
import { quote, quoteFee, fee } from "../db/schema";
import { PaymentLinkService } from "./PaymentLink.service";
import { PriceFeedService } from "./PriceFeed.service";
import { getOnchainActor } from "../shared/onchainActor";
import { CustomerService } from "./Customer.service";
import { TokenService } from "./Token.service";
import { ChainService } from "./Chain.service";
import { FeeService } from "./Fee.service";
import { AppService } from "./App.service";
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

  private resolveCustomer = async (appId: string, customerId?: string) => {
    if (!customerId) {
      return null;
    }

    const customer = await new CustomerService().getCustomerById(
      appId,
      customerId,
    );

    if (!customer) {
      throw new NotFoundError("customer", customerId);
    }

    return customer;
  };

  private quoteFees = (
    fees: (typeof fee.$inferSelect)[],
    targetAmount: bigint,
    slippageBps: number,
    operatorAddress: string,
    appAddress: string,
  ) => {
    const fees_ = fees
      .map((f) => ({
        fee: f,
        amount: new FeeService().computeFeeAmount(f, targetAmount),
        // system fees are the operator's; an app's own fees go where the app settles
        feeAddress: common.normalizeAddress(
          f.feeAddress ?? (f.appId ? appAddress : null) ?? operatorAddress,
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

    const appAddress = await new AppService().getChainAddress(appId, chain.id);
    if (!appAddress) {
      throw new AppError(
        `App doesn't accept payments on ${getChain(chain.caip2Id).name}`,
      );
    }

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
      const best = await new Uniswap().quoteExactInput({
        caip2Id: chain.caip2Id,
        tokenIn: sourceToken.address,
        amountIn: sourceAmount,
        tokenOut: settlementToken.address,
      });

      if (!best)
        throw new AppError("No pool can swap this token/amount at the moment");

      targetAmount = best.amount;
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
      const usd = await new Uniswap().quoteExactInput({
        caip2Id: chain.caip2Id,
        tokenIn: sourceToken.address,
        amountIn: sourceAmount,
        tokenOut: chainUsdToken.address,
      });

      if (!usd)
        throw new AppError("Unable to determine USD value at the moment");

      sourceUsdAmount = formatUnits(usd.amount, chainUsdToken.decimals);
      targetUsdAmount = sourceUsdAmount;
    }

    const customer = await this.resolveCustomer(appId, input.customerId);
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
        appAddress,
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

    await new PaymentLinkService().assertPayable(paymentLink);

    const chain = await new ChainService().getChainById(input.chainId);
    if (!chain) throw new NotFoundError("chain", input.chainId);
    if (!chain.config)
      throw new AppError("Selected chain is yet to be configured");

    const appAddress = await new AppService().getChainAddress(appId, chain.id);
    if (!appAddress) {
      throw new AppError(
        `App doesn't accept payments on ${getChain(chain.caip2Id).name}`,
      );
    }

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
      const settlement = await uniswap.quoteExactInput({
        caip2Id: chain.caip2Id,
        tokenIn: chainUsdToken.address,
        amountIn: usdTokenAmount,
        tokenOut: settlementToken.address,
      });

      if (!settlement)
        throw new AppError("Settlement token cannot be priced at the moment");

      targetAmount = settlement.amount;
    }

    if (targetAmount <= 0n)
      throw new AppError("Destination amount cannot be zero");

    let sourceAmount: bigint;
    let feeTier: number | null = null;

    if (sourceToken.id === settlementToken.id) {
      sourceAmount = targetAmount;
    } else {
      const best = await uniswap.quoteExactOutput({
        caip2Id: chain.caip2Id,
        tokenIn: sourceToken.address,
        amountOut: targetAmount,
        tokenOut: settlementToken.address,
      });

      if (!best)
        throw new AppError("No pool can satisfy this payment amount/token");

      sourceAmount = best.amount;
      feeTier = best.feeTier;
    }

    const targetUsdAmount = formatUnits(usdTokenAmount, chainUsdToken.decimals);
    const sourceUsdAmount = targetUsdAmount;

    const customer = await this.resolveCustomer(appId, input.customerId);
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
        appAddress,
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

  getQuotes = async (
    input: WithPageInput<{
      paymentLinkId?: string;
      customerId?: string;
      appId?: string;
      q?: string;
    }>,
  ) => {
    const pattern = input.q ? searchPattern(input.q) : undefined;
    const where = and(
      pattern
        ? or(
            sql`${quote.id}::text ilike ${pattern}`,
            ilike(quote.reference, pattern),
          )
        : undefined,
      input.appId ? eq(quote.appId, input.appId) : undefined,
      input.customerId ? eq(quote.customerId, input.customerId) : undefined,
      input.paymentLinkId
        ? eq(quote.paymentLinkId, input.paymentLinkId)
        : undefined,
    );

    return paginate(
      input,
      (limit, offset) => {
        return db.query.quote.findMany({
          where,
          orderBy: desc(quote.createdAt),
          limit,
          offset,
          with: {
            customer: true,
            paymentLink: true,
            chain: true,
            sourceToken: true,
            targetToken: true,
            fees: true,
          },
        });
      },
      async () => {
        const [row] = await db
          .select({ value: count() })
          .from(quote)
          .where(where);

        return row.value;
      },
    );
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
