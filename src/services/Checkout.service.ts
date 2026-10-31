import {
  type PaymentPayload,
  type PaymentRequirements,
} from "@x402/core/types";
import {
  TransferStatus,
  x402_MaxTimeoutSeconds,
  x402_SettlementReserveSeconds,
} from "../shared/constants";
import { AppError, NotFoundError, PreconditionError } from "../shared/errors";
import { and, desc, eq, gt, gte, isNull } from "drizzle-orm";
import { paymentLink, quote, transfer } from "../db/schema";
import { x402_RequirementSchema } from "../schemas/x402.schema";
import { PaymentLinkService } from "./PaymentLink.service";
import { TransferService } from "./Transfer.service";
import { QuoteService } from "./Quote.service";
import { TokenService } from "./Token.service";
import { ChainService } from "./Chain.service";
import { x402Service } from "./x402.service";
import { AppService } from "./App.service";
import { getChain } from "../shared/chains";
import { common } from "../shared/common";
import { db } from "../db";

type SettlementToken = {
  id: string;
  supportsEIP3009: boolean;
  version: string | null;
};

export class CheckoutService {
  private takesX402 = (config: { settlementToken: SettlementToken }) => {
    return (
      config.settlementToken.supportsEIP3009 && !!config.settlementToken.version
    );
  };

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
    await new PaymentLinkService().assertPayable(link);

    const [chains, accepted] = await Promise.all([
      new ChainService().getActiveChains(),
      new AppService().getChainIds(link.appId),
    ]);

    const tokenService = new TokenService();

    const options = await Promise.all(
      chains.map(async (chain) => {
        if (!chain.config || !accepted.has(chain.id)) {
          return null;
        }

        let meta: ReturnType<typeof getChain>;

        try {
          meta = getChain(chain.caip2Id);
        } catch {
          return null;
        }

        const x402 = this.takesX402(chain.config);
        const tokens = await tokenService.getTokensByChainId(chain.id);
        const settlementToken = chain.config.settlementToken;

        return {
          id: chain.id,
          caip2Id: chain.caip2Id,
          name: meta.name,
          icon: meta.icon,
          chainId: meta.chainId,
          testnet: !!meta.testnet,
          nativeCurrency: meta.nativeCurrency,
          blockExplorer: meta.blockExplorer,
          rpcUrls: [...meta.publicRpcUrls],
          settlementToken: {
            address: settlementToken.address,
            symbol: settlementToken.symbol,
            name: settlementToken.name,
            decimals: settlementToken.decimals,
            icon: settlementToken.icon,
            x402,
          },
          tokens: tokens.map((token) => ({
            address: token.address,
            symbol: token.symbol,
            name: token.name,
            decimals: token.decimals,
            icon: token.icon,
            x402: x402 && token.id === settlementToken.id,
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
        usage: link.usage,
        lineItems: link.lineItems,
        returnUrl: link.returnUrl,
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
    input: { chainId: string; sourceTokenAddress: string },
  ) => {
    const link = await this.requireLink(paymentLinkId);
    const chain = await new ChainService().getChainById(input.chainId);

    if (!chain) throw new NotFoundError("chain", input.chainId);
    if (!chain.isActive) throw new AppError("Selected chain is not active");
    if (!chain.config) throw new AppError("Selected chain is not configured");
    const sourceToken = await new TokenService().findTokenByAddress(
      chain.id,
      input.sourceTokenAddress,
    );
    if (!sourceToken) {
      throw new NotFoundError("token", input.sourceTokenAddress);
    }

    return new QuoteService().createQuoteFromPaymentLink(link.appId, link.id, {
      chainId: input.chainId,
      sourceTokenAddress: sourceToken.address,
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

  getReceipt = async (paymentLinkId: string) => {
    const link = await this.requireLink(paymentLinkId);

    return {
      merchant: {
        name: link.app.name,
        websiteUrl: link.app.websiteUrl,
      },
      title: link.title,
      amount: link.amount,
      currency: link.currency,
      lineItems: link.lineItems,
      returnUrl: link.returnUrl,
    };
  };

  cancelTransfer = async (paymentLinkId: string, transferId: string) => {
    const transferService = new TransferService();
    const link = await this.requireLink(paymentLinkId);
    const row = await transferService.getTransfer(link.appId, transferId);

    if (!row || row.quote.paymentLinkId !== link.id) {
      throw new NotFoundError("transfer", transferId);
    }

    if (row.status !== TransferStatus.AwaitingDeposit) {
      throw new PreconditionError("This transfer can no longer be cancelled");
    }

    const balance = await transferService.getRecoveryBalance(
      transferId,
      row.quote.sourceToken.address,
    );

    if (balance > 0n) {
      throw new PreconditionError(
        "A payment has already arrived for this transfer",
      );
    }

    const cancelled = await db.transaction(async (tx) => {
      // holds off an x402 reservation until this one is decided
      const [locked] = await tx
        .select({
          x402Offer: transfer.x402Offer,
          x402AuthorizationNonce: transfer.x402AuthorizationNonce,
        })
        .from(transfer)
        .where(eq(transfer.id, transferId))
        .for("update");

      if (!locked || locked.x402Offer || locked.x402AuthorizationNonce) {
        return false;
      }

      return transferService.transitionTransferStatus(
        transferId,
        TransferStatus.AwaitingDeposit,
        TransferStatus.Cancelled,
        "Cancelled by the payer",
        undefined,
        tx,
      );
    });

    if (!cancelled) {
      throw new PreconditionError("This transfer can no longer be cancelled");
    }

    return this.getTransfer(paymentLinkId, transferId);
  };

  private findX402Offer = async (
    link: {
      id: string;
      appId: string;
      updatedAt: Date;
    },
    chainId: string,
    settlementTokenId: string,
  ) => {
    const reusableUntil = new Date(
      Date.now() +
        common.toMs(x402_MaxTimeoutSeconds + x402_SettlementReserveSeconds),
    );

    const [offer] = await db
      .select({ id: transfer.id })
      .from(transfer)
      .innerJoin(quote, eq(quote.id, transfer.quoteId))
      .where(
        and(
          eq(transfer.appId, link.appId),
          eq(transfer.x402Offer, true),
          eq(transfer.status, TransferStatus.AwaitingDeposit),
          isNull(transfer.x402AuthorizationNonce),
          eq(quote.paymentLinkId, link.id),
          eq(quote.chainId, chainId),
          eq(quote.sourceTokenId, settlementTokenId),
          gt(quote.expiresAt, reusableUntil),
          gte(quote.createdAt, link.updatedAt),
        ),
      )
      .orderBy(desc(quote.expiresAt))
      .limit(1);

    return offer?.id;
  };

  private openX402Offer = async (
    link: { id: string; appId: string },
    chainId: string,
  ) => {
    const chain = await new ChainService().getChainById(chainId);
    if (!chain?.config) throw new AppError("Selected chain is not configured");

    const created = await this.createQuote(link.id, {
      chainId,
      sourceTokenAddress: chain.config.settlementToken.address,
    });
    const opened = await new x402Service().createTransfer(
      link.appId,
      created.id,
    );

    await db
      .update(transfer)
      .set({ x402Offer: true })
      .where(eq(transfer.id, opened.id));

    return opened;
  };

  offerX402 = async (paymentLinkId: string) => {
    const link = await this.requireLink(paymentLinkId);
    await new PaymentLinkService().assertPayable(link);

    const [chains, accepted] = await Promise.all([
      new ChainService().getActiveChains(),
      new AppService().getChainIds(link.appId),
    ]);

    const x402 = new x402Service();

    const offers = await Promise.allSettled(
      chains.map(async (chain) => {
        if (
          !chain.config ||
          !accepted.has(chain.id) ||
          !this.takesX402(chain.config)
        ) {
          return null;
        }

        let transferId = await this.findX402Offer(
          link,
          chain.id,
          chain.config.settlementToken.id,
        );

        if (!transferId) {
          const offer = await this.openX402Offer(link, chain.id);
          transferId = offer.id;
        }

        return x402.getPaymentRequirements(link.appId, transferId);
      }),
    );

    const accepts = offers.flatMap((offer) =>
      offer.status === "fulfilled" && offer.value ? [offer.value] : [],
    );

    if (!accepts.length) {
      const failed = offers.find((offer) => offer.status === "rejected");
      if (failed) {
        throw failed.reason;
      }

      throw new PreconditionError("This link can't be paid with x402");
    }

    return {
      title: link.title,
      accepts,
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
      () => new PaymentLinkService().assertPayable(link),
    );
  };

  getX402TransferId = async (paymentLinkId: string, payTo: string) => {
    const link = await this.requireLink(paymentLinkId);
    const transfer = await new TransferService().getTransferByPayinAddress(
      link.appId,
      payTo,
    );

    if (!transfer || transfer.quote.paymentLinkId !== link.id) {
      throw new NotFoundError("transfer", payTo);
    }

    if (transfer.quote.sourceTokenId !== transfer.quote.targetTokenId) {
      throw new AppError("x402 requires the chain settlement token");
    }

    return transfer.id;
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
