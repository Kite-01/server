import { QuoteTTL_Ms, UniswapFeeTiers } from "../shared/constants";
import { AppError, NotFoundError } from "../shared/errors";
import { type PaymentLinkService } from "./PaymentLink.service";
import { formatUnits, parseUnits } from "viem";
import { type PriceFeedService } from "./PriceFeed.service";
import { and, eq, desc, isNull } from "drizzle-orm";
import { quote, quoteFee, fee } from "../db/schema";
import { type CustomerService } from "./Customer.service";
import { type TokenService } from "./Token.service";
import { type ChainService } from "./Chain.service";
import { getOnchainActor } from "../shared/onchainActor";
import { type FeeService } from "./Fee.service";
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
  constructor(
    private readonly paymentLinkService: PaymentLinkService,
    private readonly chainService: ChainService,
    private readonly tokenService: TokenService,
    private readonly priceFeedService: PriceFeedService,
    private readonly feeService: FeeService,
    private readonly customerService: CustomerService,
  ) {}

  private insertQuote = async (input: {
    quote: typeof quote.$inferInsert;
    fees: (typeof fee.$inferSelect)[];
    serverAddress: string;
    settlementAddress: Maybe<string>;
  }) => {
    return db.transaction(async (transaction) => {
      const [q] = await transaction
        .insert(quote)
        .values(input.quote)
        .returning();

      if (input.fees.length) {
        await transaction.insert(quoteFee).values(
          input.fees.map((f) => ({
            quoteId: q.id,
            feeId: f.id,
            label: f.label,
            amount: this.feeService.computeFeeAmount(
              f,
              input.quote.targetAmount,
            ),
            feeAddress:
              f.feeAddress ?? input.settlementAddress ?? input.serverAddress,
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
    const chain = await this.chainService.getChainById(input.chainId);
    if (!chain) throw new NotFoundError("chain", input.chainId);
    if (!chain.config)
      throw new AppError("Selected chain is yet to be configured");

    const settlementToken = chain.config.settlementToken;
    const chainUsdToken = chain.config.usdPeggedToken;
    const sourceToken = await this.tokenService.getTokenByAddress(
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

    const rate =
      Number(formatUnits(targetAmount, settlementToken.decimals)) /
      Number(formatUnits(sourceAmount, sourceToken.decimals));

    let sourceUsdAmount: number;
    let targetUsdAmount: number;

    if (sourceToken.id === chainUsdToken.id) {
      sourceUsdAmount = Number(formatUnits(sourceAmount, sourceToken.decimals));
      targetUsdAmount =
        settlementToken.id === chainUsdToken.id
          ? Number(formatUnits(targetAmount, settlementToken.decimals))
          : sourceUsdAmount;
    } else if (settlementToken.id === chainUsdToken.id) {
      targetUsdAmount = Number(
        formatUnits(targetAmount, settlementToken.decimals),
      );
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

      sourceUsdAmount = Number(formatUnits(bestUsdOut, chainUsdToken.decimals));
      targetUsdAmount = sourceUsdAmount;
    }

    const customer = input.customerId
      ? await this.customerService.getCustomerById(appId, input.customerId)
      : null;

    const fees = await this.feeService.getMatchingFees(appId, chain.id, {
      customer,
      sourceAmount,
      sourceToken,
      targetToken: settlementToken,
    });

    return this.insertQuote({
      fees,
      serverAddress: getOnchainActor(getChain(chain.caip2Id).type).getAddress(),
      settlementAddress: chain.config.settlementAddress,
      quote: {
        appId,
        customerId: input.customerId,
        chainId: chain.id,
        sourceTokenId: sourceToken.id,
        targetTokenId: settlementToken.id,
        sourceAmount,
        sourceUsdAmount,
        targetAmount,
        targetUsdAmount,
        rate: String(rate),
        uniswapPoolFeeTier: feeTier,
        reference: input.reference,
        meta: input.meta,
        expiresAt: new Date(Date.now() + common.toMs(QuoteTTL_Ms)),
      },
    });
  };

  createQuoteFromPaymentLink = async (
    appId: string,
    paymentLinkId: string,
    input: QuoteBase,
  ) => {
    const paymentLink = await this.paymentLinkService.getPaymentLink(
      appId,
      paymentLinkId,
    );

    if (!paymentLink) {
      throw new NotFoundError("paymentLink", paymentLinkId);
    }

    const chain = await this.chainService.getChainById(input.chainId);
    if (!chain) throw new NotFoundError("chain", input.chainId);
    if (!chain.config)
      throw new AppError("Selected chain is yet to be configured");

    const settlementToken = chain.config.settlementToken;
    const chainUsdToken = chain.config.usdPeggedToken;
    const sourceToken = await this.tokenService.getTokenByAddress(
      chain.id,
      input.sourceTokenAddress,
    );

    const currency = paymentLink.currency.toUpperCase();
    const fxPrice =
      currency === "USD"
        ? 1
        : await this.priceFeedService.getPrice(currency, "USD");

    const AmountDecimals = 8;
    const FxDecimals = 12;

    const amountScaled = parseUnits(String(paymentLink.amount), AmountDecimals);
    const fxScaled = parseUnits(String(fxPrice), FxDecimals);
    const usdTokenAmount = common.ceilDiv(
      amountScaled * fxScaled * common.pow10(chainUsdToken.decimals),
      common.pow10(AmountDecimals + FxDecimals),
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

    const rate =
      Number(formatUnits(targetAmount, settlementToken.decimals)) /
      Number(formatUnits(sourceAmount, sourceToken.decimals));

    const targetUsdAmount = Number(
      formatUnits(usdTokenAmount, chainUsdToken.decimals),
    );

    const sourceUsdAmount = targetUsdAmount;

    const customer = input.customerId
      ? await this.customerService.getCustomerById(appId, input.customerId)
      : null;

    const fees = await this.feeService.getMatchingFees(appId, chain.id, {
      customer,
      sourceAmount,
      sourceToken,
      targetToken: settlementToken,
    });

    return this.insertQuote({
      fees,
      serverAddress: getOnchainActor(getChain(chain.caip2Id).type).getAddress(),
      settlementAddress: chain.config.settlementAddress,
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
        rate: String(rate),
        uniswapPoolFeeTier: feeTier,
        reference: input.reference,
        meta: input.meta,
        expiresAt: new Date(Date.now() + common.toMs(QuoteTTL_Ms)),
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
