import {
  ChainNotConfiguredForx402Error,
  NotFoundError,
  PreconditionError,
  QuoteExpiredError,
} from "../shared/errors";
import {
  x402_PaymentPayloadSchema,
  x402_RequirementSchema,
} from "../schemas/x402.schema";
import {
  type PaymentPayload,
  type PaymentRequirements,
} from "@x402/core/types";
import { ChainType, TransferStatus } from "../shared/constants";
import { x402EvmFacilitatorSigner } from "../sdks/x402EvmFacilitatorSigner";
import { keccak256, type Hex } from "viem";
import { PaymentLinkService } from "./PaymentLink.service";
import { PriceFeedService } from "./PriceFeed.service";
import { CustomerService } from "./Customer.service";
import { x402Facilitator } from "@x402/core/facilitator";
import { getOnchainActor } from "../shared/onchainActor";
import { and, eq, isNull } from "drizzle-orm";
import { TransferService } from "./Transfer.service";
import { ExactEvmScheme } from "@x402/evm/exact/facilitator";
import { QuoteService } from "./Quote.service";
import { TokenService } from "./Token.service";
import { ChainService } from "./Chain.service";
import { FeeService } from "./Fee.service";
import { KvService } from "./Kv.service";
import { transfer } from "../db/schema";
import { common } from "../shared/common";
import { db } from "../db";

export class x402Service {
  constructor(
    private readonly chainService: ChainService,
    private readonly tokenService: TokenService,
    private readonly transferService: TransferService,
    private readonly facilitator: x402Facilitator,
    private readonly supportedChains: Set<Caip2Id>,
  ) {}

  static create = async (): Promise<x402Service> => {
    const kvService = new KvService();
    const chainService = new ChainService(kvService);
    const tokenService = new TokenService(chainService);
    const quoteService = new QuoteService(
      new PaymentLinkService(),
      chainService,
      tokenService,
      new PriceFeedService(chainService),
      new FeeService(),
      new CustomerService(),
    );

    const transferService = new TransferService(
      kvService,
      chainService,
      tokenService,
      quoteService,
    );

    const facilitator = new x402Facilitator();
    const supportedChains = new Set<Caip2Id>();
    const options: SdkOptions = {
      variables: await kvService.getSdkOptionVariables(),
    };

    const chains = await chainService.getActiveChains();
    const onchainActor = getOnchainActor(ChainType.Evm);

    for (const chain of chains) {
      if (!chain.config?.gasSponsorProviders.length) {
        continue;
      }

      const caip2Id = chain.caip2Id;
      const signer = new x402EvmFacilitatorSigner(
        chain.caip2Id,
        onchainActor,
        options,
        chain.config.rpcUrls ?? [],
      );

      facilitator.register(caip2Id, new ExactEvmScheme(signer));
      supportedChains.add(caip2Id);
    }

    return new x402Service(
      chainService,
      tokenService,
      transferService,
      facilitator,
      supportedChains,
    );
  };

  private validatePayment = async (
    appId: string,
    paymentPayload: PaymentPayload,
    paymentRequirements: PaymentRequirements,
    allowReservedRetry = false,
  ) => {
    const payment = x402_PaymentPayloadSchema.parse(paymentPayload);
    const requirements = x402_RequirementSchema.parse(paymentRequirements);
    const payload = payment.payload;
    const payer = common.normalizeAddress(payload.authorization.from);
    const nonce = payload.authorization.nonce.toLowerCase();
    const authorizationHash = keccak256(payload.signature as Hex);
    const transfer = await this.transferService.getTransferByPayinAddress(
      appId,
      requirements.payTo,
    );

    if (!transfer) {
      throw new NotFoundError("transfer", requirements.payTo);
    }

    const accepted = payment.accepted;

    if (
      accepted.scheme !== requirements.scheme ||
      accepted.network !== requirements.network ||
      accepted.amount !== requirements.amount ||
      common.normalizeAddress(accepted.asset) !==
        common.normalizeAddress(requirements.asset) ||
      common.normalizeAddress(accepted.payTo) !==
        common.normalizeAddress(requirements.payTo)
    ) {
      throw new PreconditionError(
        "Payment terms do not match payment requirements",
      );
    }

    const matchesReservation =
      transfer.x402Payer === payer &&
      transfer.x402AuthorizationNonce === nonce &&
      transfer.x402AuthorizationHash === authorizationHash;

    const reserveRetry = !allowReservedRetry || !matchesReservation;

    if (transfer.x402AuthorizationNonce && reserveRetry) {
      throw new PreconditionError(
        "Transfer already has a reserved x402 authorization",
      );
    }

    if (transfer.status !== TransferStatus.AwaitingDeposit && reserveRetry) {
      throw new PreconditionError("Transfer is not awaiting a deposit");
    }

    if (transfer.quote.expiresAt.getTime() <= Date.now() && reserveRetry) {
      throw new QuoteExpiredError(transfer.quote.id);
    }

    if (requirements.scheme !== "exact") {
      throw new PreconditionError("Only the exact x402 scheme is supported");
    }

    if (requirements.network !== transfer.quote.chain.caip2Id) {
      throw new PreconditionError(
        "Payment network does not match the transfer",
      );
    }

    if (
      common.normalizeAddress(requirements.asset) !==
      common.normalizeAddress(transfer.quote.sourceToken.address)
    ) {
      throw new PreconditionError("Payment asset does not match source token");
    }

    if (requirements.amount !== transfer.quote.sourceAmount.toString()) {
      throw new PreconditionError("Payment amount does not match the quote");
    }

    if (
      common.normalizeAddress(requirements.payTo) !==
      common.normalizeAddress(transfer.payinAddress)
    ) {
      throw new PreconditionError(
        '"PayTo" does not match the transfer address',
      );
    }

    if (
      common.normalizeAddress(payload.authorization.to) !==
      common.normalizeAddress(transfer.payinAddress)
    ) {
      throw new PreconditionError(
        "Authorization destination does not match payTo",
      );
    }

    if (payload.authorization.value !== requirements.amount) {
      throw new PreconditionError(
        "Authorization value does not match the quote",
      );
    }

    return {
      payment: {
        payer,
        nonce,
        authorizationHash,
        payload,
        transfer,
      },
      paymentPayload: payment as PaymentPayload,
      requirements: requirements as PaymentRequirements,
    };
  };

  getSupported = async () => {
    const kinds: Array<{
      x402Version: number;
      scheme: string;
      network: string;
      extra?: Record<string, unknown>;
    }> = [];

    const registered = this.facilitator.getSupported();
    const chains = await this.chainService.getActiveChains();

    for (const chain of chains) {
      if (!chain.config) continue;
      if (!this.supportedChains.has(chain.caip2Id)) continue;

      const token = chain.config.settlementToken;
      const domain = await this.tokenService.readTokenDomain(
        chain.caip2Id,
        token.address,
      );

      if (!domain) {
        // settlement token does not support EIP-3009
        // don't advertise chain
        continue;
      }

      kinds.push({
        x402Version: 2,
        scheme: "exact",
        network: chain.caip2Id,
        extra: {
          asset: token.address.toLowerCase(),
          name: domain.name,
          version: domain.version,
        },
      });
    }

    return {
      kinds,
      extensions: registered.extensions,
      signers: registered.signers,
    };
  };

  createTransfer = async (appId: string, quoteId: string) => {
    const operatorAddress = getOnchainActor(ChainType.Evm).getAddress();
    return this.transferService.createTransfer(appId, quoteId, operatorAddress);
  };

  getPaymentRequirements = async (appId: string, transferId: string) => {
    const transfer = await this.transferService.getTransfer(appId, transferId);
    if (!transfer) throw new NotFoundError("transfer", transferId);

    if (transfer.status !== TransferStatus.AwaitingDeposit) {
      throw new PreconditionError("Transfer is not awaiting a deposit");
    }

    if (transfer.quote.expiresAt.getTime() <= Date.now()) {
      throw new QuoteExpiredError(transfer.quote.id);
    }

    const caip2Id = transfer.quote.chain.caip2Id;
    if (!this.supportedChains.has(caip2Id))
      throw new ChainNotConfiguredForx402Error(caip2Id);

    const domain = await this.tokenService.readTokenDomain(
      caip2Id,
      transfer.quote.sourceToken.address,
    );

    if (!domain) throw new ChainNotConfiguredForx402Error(caip2Id);

    return {
      scheme: "exact" as const,
      network: caip2Id,
      asset: transfer.quote.sourceToken.address,
      amount: transfer.quote.sourceAmount.toString(),
      payTo: transfer.payinAddress,
      maxTimeoutSeconds: 120,
      extra: {
        name: domain.name,
        version: domain.version,
      },
    };
  };

  verify = async (
    appId: string,
    paymentPayload: PaymentPayload,
    paymentRequirements: PaymentRequirements,
  ) => {
    const ctx = await this.validatePayment(
      appId,
      paymentPayload,
      paymentRequirements,
    );

    return this.facilitator.verify(ctx.paymentPayload, ctx.requirements);
  };

  settle = async (
    appId: string,
    paymentPayload: PaymentPayload,
    paymentRequirements: PaymentRequirements,
  ) => {
    const ctx = await this.validatePayment(
      appId,
      paymentPayload,
      paymentRequirements,
      true,
    );

    const transfer_ = ctx.payment.transfer;
    const caip2Id = transfer_.quote.chain.caip2Id;

    if (transfer_.x402AuthorizationNonce) {
      if (
        transfer_.x402Payer !== ctx.payment.payer ||
        transfer_.x402AuthorizationNonce !== ctx.payment.nonce ||
        transfer_.x402AuthorizationHash !== ctx.payment.authorizationHash
      ) {
        throw new PreconditionError(
          "Transfer has a different x402 authorization",
        );
      }

      if (transfer_.x402BlockchainHash) {
        return {
          success: true,
          payer: ctx.payment.payer,
          transaction: transfer_.x402BlockchainHash,
          network: caip2Id,
        };
      }

      throw new PreconditionError(
        "x402 authorization is already reserved for settlement",
      );
    }

    const verification = await this.facilitator.verify(
      ctx.paymentPayload,
      ctx.requirements,
    );

    if (!verification.isValid) {
      return {
        success: false,
        errorReason: verification.invalidReason,
        errorMessage: verification.invalidMessage,
        payer: ctx.payment.payer,
        transaction: "",
        network: caip2Id,
      };
    }

    const [reserved] = await db
      .update(transfer)
      .set({
        x402Payer: ctx.payment.payer,
        x402AuthorizationNonce: ctx.payment.nonce,
        x402AuthorizationHash: ctx.payment.authorizationHash,
      })
      .where(
        and(
          eq(transfer.id, transfer_.id),
          eq(transfer.status, TransferStatus.AwaitingDeposit),
          isNull(transfer.x402AuthorizationNonce),
        ),
      )
      .returning();

    if (!reserved) {
      throw new PreconditionError(
        "another x402 settlement is already in progress for this transfer",
      );
    }

    const result = await this.facilitator.settle(
      ctx.paymentPayload,
      ctx.requirements,
    );

    if (result.success) {
      await db
        .update(transfer)
        .set({ x402BlockchainHash: result.transaction })
        .where(eq(transfer.id, transfer_.id));
    } else {
      await db
        .update(transfer)
        .set({
          x402Payer: null,
          x402AuthorizationNonce: null,
          x402AuthorizationHash: null,
        })
        .where(
          and(
            eq(transfer.id, transfer_.id),
            eq(transfer.x402AuthorizationNonce, ctx.payment.nonce),
            isNull(transfer.x402BlockchainHash),
          ),
        );
    }

    if (result.success) {
      await this.transferService.transitionTransferStatus(
        transfer_.id,
        transfer_.status,
        TransferStatus.x402Settled,
        "x402 authorization settled",
      );
    }

    return result;
  };
}
