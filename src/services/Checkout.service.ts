import {
  type PaymentPayload,
  type PaymentRequirements,
} from "@x402/core/types";
import { x402_RequirementSchema } from "../schemas/x402.schema";
import { TransferService } from "./Transfer.service";
import { NotFoundError } from "../shared/errors";
import { QuoteService } from "./Quote.service";
import { TokenService } from "./Token.service";
import { ChainService } from "./Chain.service";
import { x402Service } from "./x402.service";
import { paymentLink } from "../db/schema";
import { getChain } from "../shared/chains";
import { eq } from "drizzle-orm";
import { db } from "../db";

export class CheckoutService {
  private requireLink = async (paymentLinkId: string) => {
    const link = await db.query.paymentLink.findFirst({
      where: eq(paymentLink.id, paymentLinkId),
      with: {
        app: true,
      },
    });

    if (!link || link.app.deletedAt) {
      throw new NotFoundError("paymentLink", paymentLinkId);
    }

    return link;
  };

  private requireQuote = async (paymentLinkId: string, quoteId: string) => {
    const link = await this.requireLink(paymentLinkId);
    const quote = await new QuoteService().getQuote(link.appId, quoteId);

    if (!quote || quote.paymentLinkId !== link.id) {
      throw new NotFoundError("quote", quoteId);
    }

    return { link, quote };
  };

  getCheckout = async (paymentLinkId: string) => {
    const link = await this.requireLink(paymentLinkId);
    const chains = await new ChainService().getActiveChains();
    const tokenService = new TokenService();

    const options = await Promise.all(
      chains.map(async (chain) => {
        if (!chain.config) {
          return null;
        }

        let meta: ReturnType<typeof getChain>;

        try {
          meta = getChain(chain.caip2Id);
        } catch {
          return null;
        }

        const gasless = chain.config.gasSponsorProviders.length > 0;
        const tokens = await tokenService.getTokensByChainId(chain.id);

        return {
          id: chain.id,
          caip2Id: chain.caip2Id,
          name: meta.name,
          chainId: meta.chainId,
          nativeCurrency: meta.nativeCurrency,
          blockExplorer: meta.blockExplorer,
          rpcUrls: [...meta.publicRpcUrls],
          tokens: tokens.map((token) => ({
            address: token.address,
            symbol: token.symbol,
            name: token.name,
            decimals: token.decimals,
            icon: token.icon,
            x402: gasless && token.supportsEIP3009 && !!token.version,
          })),
        };
      }),
    );

    return {
      paymentLink: {
        id: link.id,
        title: link.title,
        currency: link.currency,
        amount: link.amount,
        lineItems: link.lineItems,
      },
      app: {
        name: link.app.name,
        icon: link.app.icon,
        websiteUrl: link.app.websiteUrl,
        termsOfServiceUrl: link.app.termsOfServiceUrl,
        privacyPolicyUrl: link.app.privacyPolicyUrl,
      },
      chains: options.filter(
        (option): option is NonNullable<typeof option> =>
          !!option?.tokens.length,
      ),
    };
  };

  createQuote = async (
    paymentLinkId: string,
    input: {
      chainId: string;
      sourceTokenAddress: string;
    },
  ) => {
    const link = await this.requireLink(paymentLinkId);
    const token = await new TokenService().findTokenByAddress(
      input.chainId,
      input.sourceTokenAddress,
    );

    if (!token) {
      throw new NotFoundError("token", input.sourceTokenAddress);
    }

    return new QuoteService().createQuoteFromPaymentLink(link.appId, link.id, {
      chainId: input.chainId,
      sourceTokenAddress: token.address,
    });
  };

  createTransfer = async (
    paymentLinkId: string,
    quoteId: string,
    refundAddress: string,
  ) => {
    const { link } = await this.requireQuote(paymentLinkId, quoteId);

    return new TransferService().createTransfer(
      link.appId,
      quoteId,
      refundAddress,
    );
  };

  createX402Payment = async (
    paymentLinkId: string,
    quoteId: string,
    refundAddress?: string,
  ) => {
    const { link } = await this.requireQuote(paymentLinkId, quoteId);
    const x402 = new x402Service();

    let transfer;

    if (refundAddress) {
      transfer = await new TransferService().createTransfer(
        link.appId,
        quoteId,
        refundAddress,
      );
    } else {
      transfer = await x402.createTransfer(link.appId, quoteId);
    }

    return {
      transfer,
      requirements: await x402.getPaymentRequirements(link.appId, transfer.id),
    };
  };

  settleX402Payment = async (
    paymentLinkId: string,
    paymentPayload: PaymentPayload,
    paymentRequirements: PaymentRequirements,
  ) => {
    const link = await this.requireLink(paymentLinkId);
    const { payTo } = x402_RequirementSchema.parse(paymentRequirements);
    const transfer = await new TransferService().getTransferByPayinAddress(
      link.appId,
      payTo,
    );

    if (!transfer || transfer.quote.paymentLinkId !== link.id) {
      throw new NotFoundError("transfer", payTo);
    }

    return new x402Service().settle(
      link.appId,
      paymentPayload,
      paymentRequirements,
    );
  };

  getTransfer = async (paymentLinkId: string, transferId: string) => {
    const link = await this.requireLink(paymentLinkId);
    const transfer = await new TransferService().getTransfer(
      link.appId,
      transferId,
    );

    if (!transfer || transfer.quote.paymentLinkId !== link.id) {
      throw new NotFoundError("transfer", transferId);
    }

    return {
      id: transfer.id,
      status: transfer.status,
      payinAddress: transfer.payinAddress,
      x402BlockchainHash: transfer.x402BlockchainHash,
      settlementBlockchainHash: transfer.settlementBlockchainHash,
      refundBlockchainHash: transfer.refundBlockchainHash,
      expiresAt: transfer.quote.expiresAt,
      updatedAt: transfer.updatedAt,
    };
  };
}
