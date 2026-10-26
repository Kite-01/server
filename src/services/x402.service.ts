import {
  ChainNotConfiguredForx402Error,
  PreconditionError,
  QuoteExpiredError,
  NotFoundError,
} from "../shared/errors";
import {
  x402_PaymentPayloadSchema,
  x402_RequirementSchema,
} from "../schemas/x402.schema";
import {
  type PaymentRequirements,
  type PaymentPayload,
  type SettleResponse,
  type VerifyResponse,
} from "@x402/core/types";
import {
  ChainType,
  TransferStatus,
  x402_MaxTimeoutSeconds,
  x402_SettlementReserveSeconds,
  x402_MinTimeoutSeconds,
  x402_SettlementLeaseSeconds,
} from "../shared/constants";
import { getAddress, keccak256, parseAbiItem, type Hex } from "viem";
import { x402EvmFacilitatorSigner } from "../sdks/x402EvmFacilitatorSigner";
import { deposit, token, transfer } from "../db/schema";
import { and, eq, isNull, sql } from "drizzle-orm";
import { withX402Observer } from "../shared/context/x402";
import { x402Facilitator } from "@x402/core/facilitator";
import { getOnchainActor } from "../shared/onchainActor";
import { TransferService } from "./Transfer.service";
import { ExactEvmScheme } from "@x402/evm/exact/facilitator";
import { TokenService } from "./Token.service";
import { ChainService } from "./Chain.service";
import { KvService } from "./Kv.service";
import { Scheduler } from "../shared/scheduler";
import { common } from "../shared/common";
import { kite } from "../shared/kiteContract";
import { db } from "../db";

type ValidatedPayment = Awaited<ReturnType<x402Service["validatePayment"]>>;

export class x402Service {
  private readonly facilitators = new Map<Caip2Id, x402Facilitator>();

  private facilitatorFor = async (caip2Id: Caip2Id) => {
    const chain = await new ChainService().getChainByCaip2Id(caip2Id);
    if (!chain?.isActive || !chain.config) {
      throw new ChainNotConfiguredForx402Error(caip2Id);
    }

    let facilitator = this.facilitators.get(caip2Id);

    if (!facilitator) {
      const signer = new x402EvmFacilitatorSigner(
        caip2Id,
        getOnchainActor(ChainType.Evm),
      );

      facilitator = new x402Facilitator().register(
        caip2Id,
        new ExactEvmScheme(signer, {
          pendingSettlementStore: {
            get: async (signature: string) => {
              const row = await db.query.transfer.findFirst({
                where: eq(
                  transfer.x402AuthorizationHash,
                  keccak256(signature as Hex),
                ),
                columns: {
                  x402BlockchainHash: true,
                },
              });

              return row?.x402BlockchainHash ?? undefined;
            },
            set: async (signature: string, transactionHash: string) => {
              await db
                .update(transfer)
                .set({ x402BlockchainHash: transactionHash })
                .where(
                  and(
                    eq(
                      transfer.x402AuthorizationHash,
                      keccak256(signature as Hex),
                    ),
                    isNull(transfer.x402BlockchainHash),
                  ),
                );
            },
            // reservations are cleared by this service once an outcome is known
            delete: async () => undefined,
          },
        }),
      );

      this.facilitators.set(caip2Id, facilitator);
    }

    return facilitator;
  };

  private assertCanTakePayment = (
    transfer_: {
      status: TransferStatus;
      quote: {
        id: string;
        expiresAt: Date;
      };
    },
    validBefore: string,
  ) => {
    if (transfer_.status !== TransferStatus.AwaitingDeposit) {
      throw new PreconditionError("Transfer is not awaiting a deposit");
    }

    const deadline = this.x402SettlementDeadline(transfer_.quote.expiresAt);
    if (Math.floor(Date.now() / 1000) > deadline) {
      throw new QuoteExpiredError(transfer_.quote.id);
    }

    if (BigInt(validBefore) > BigInt(deadline)) {
      throw new PreconditionError(
        "The authorization stays valid past the transfer's settlement window; sign it with a shorter validity",
      );
    }
  };

  private validatePayment = async (
    appId: string,
    paymentPayload: PaymentPayload,
    paymentRequirements: PaymentRequirements,
    allowReservedRetry = false,
  ) => {
    const payment = x402_PaymentPayloadSchema.parse(paymentPayload);
    const requirements = x402_RequirementSchema.parse(paymentRequirements);

    const authorization = payment.payload.authorization;
    const payer = common.normalizeAddress(authorization.from);
    const nonce = authorization.nonce.toLowerCase();
    const authorizationHash = keccak256(payment.payload.signature as Hex);
    const transfer_ = await new TransferService().getTransferByPayinAddress(
      appId,
      requirements.payTo,
    );

    if (!transfer_) {
      throw new NotFoundError("transfer", requirements.payTo);
    }

    const accepted = payment.accepted;

    if (
      accepted.scheme !== requirements.scheme ||
      accepted.network !== requirements.network ||
      accepted.amount !== requirements.amount ||
      !common.isSameAddress(accepted.asset, requirements.asset) ||
      !common.isSameAddress(accepted.payTo, requirements.payTo)
    ) {
      throw new PreconditionError(
        "Payment terms do not match payment requirements",
      );
    }

    const matchesReservation =
      allowReservedRetry &&
      transfer_.x402Payer === payer &&
      transfer_.x402AuthorizationNonce === nonce &&
      transfer_.x402AuthorizationHash === authorizationHash;

    if (!matchesReservation) {
      if (transfer_.x402AuthorizationNonce) {
        throw new PreconditionError(
          "Transfer already has a reserved x402 authorization",
        );
      }

      this.assertCanTakePayment(transfer_, authorization.validBefore);
    }

    if (requirements.scheme !== "exact") {
      throw new PreconditionError("Only the exact x402 scheme is supported");
    }

    if (requirements.network !== transfer_.quote.chain.caip2Id) {
      throw new PreconditionError(
        "Payment network does not match the transfer",
      );
    }

    if (
      !common.isSameAddress(
        requirements.asset,
        transfer_.quote.sourceToken.address,
      )
    ) {
      throw new PreconditionError("Payment asset does not match source token");
    }

    if (requirements.amount !== transfer_.quote.sourceAmount.toString()) {
      throw new PreconditionError("Payment amount does not match the quote");
    }

    if (!common.isSameAddress(requirements.payTo, transfer_.payinAddress)) {
      throw new PreconditionError(
        '"PayTo" does not match the transfer address',
      );
    }

    if (!common.isSameAddress(authorization.to, transfer_.payinAddress)) {
      throw new PreconditionError(
        "Authorization destination does not match payTo",
      );
    }

    if (authorization.value !== requirements.amount) {
      throw new PreconditionError(
        "Authorization value does not match the quote",
      );
    }

    return {
      payment: {
        payer,
        nonce,
        authorizationHash,
        authorization,
        transfer: transfer_,
        matchesReservation,
      },
      paymentPayload,
      paymentRequirements,
    };
  };

  private reserve = async (transferId: string, ctx: ValidatedPayment) => {
    const [row] = await db
      .update(transfer)
      .set({
        x402Payer: ctx.payment.payer,
        x402AuthorizationNonce: ctx.payment.nonce,
        x402AuthorizationHash: ctx.payment.authorizationHash,
        x402SettlementCallId: null,
        x402BlockchainHash: null,
        x402LeaseExpiresAt: new Date(
          Date.now() + common.toMs(x402_SettlementLeaseSeconds),
        ),
      })
      .where(
        and(
          eq(transfer.id, transferId),
          eq(transfer.status, TransferStatus.AwaitingDeposit),
          isNull(transfer.x402AuthorizationNonce),
        ),
      )
      .returning({ id: transfer.id });

    return !!row;
  };

  private clearReservation = async (transferId: string, nonce: string) => {
    await db
      .update(transfer)
      .set({
        x402Payer: null,
        x402AuthorizationNonce: null,
        x402AuthorizationHash: null,
        x402SettlementCallId: null,
        x402BlockchainHash: null,
        x402LeaseExpiresAt: null,
        // not offered again: the released authorization may still land
        x402Offer: false,
      })
      .where(
        and(
          eq(transfer.id, transferId),
          eq(transfer.x402AuthorizationNonce, nonce),
        ),
      );
  };

  private paysAuthorization = async (
    caip2Id: Caip2Id,
    transactionHash: string,
    ctx: ValidatedPayment,
  ) => {
    const client = await getOnchainActor(ChainType.Evm).publicClient(caip2Id);
    const receipt = await client
      .getTransactionReceipt({ hash: transactionHash as Hex })
      .catch(() => null);

    if (!receipt) return null;
    if (receipt.status !== "success") return false;

    const { authorization } = ctx.payment;

    return receipt.logs.some((log) => {
      const transferLog = kite.parseErc20TransferLog({
        ...log,
        logIndex: log.logIndex.toString(),
      });

      return (
        !!transferLog &&
        common.isSameAddress(
          transferLog.token,
          ctx.paymentRequirements.asset,
        ) &&
        common.isSameAddress(transferLog.from, authorization.from) &&
        common.isSameAddress(transferLog.to, authorization.to) &&
        transferLog.amount === BigInt(authorization.value)
      );
    });
  };

  private findAuthorizationTransaction = async (
    caip2Id: Caip2Id,
    ctx: ValidatedPayment,
  ) => {
    const { transfer: transfer_, authorization } = ctx.payment;

    const tokenRow = await db.query.token.findFirst({
      where: and(
        eq(token.chainId, transfer_.quote.chainId),
        eq(token.address, getAddress(ctx.paymentRequirements.asset)),
      ),
    });

    if (tokenRow) {
      const recorded = await db.query.deposit.findFirst({
        where: and(
          eq(deposit.address, transfer_.payinAddress),
          eq(deposit.tokenId, tokenRow.id),
          eq(deposit.senderAddress, getAddress(authorization.from)),
          eq(deposit.amount, BigInt(authorization.value)),
        ),
      });

      if (recorded) return recorded.blockchainHash;
    }

    try {
      // how far back to look for an authorization's transaction (well beyond a quote's life)
      const AuthorizationLookbackBlocks = 5000n;
      const AuthorizationUsedEvent = parseAbiItem(
        "event AuthorizationUsed(address indexed authorizer, bytes32 indexed nonce)",
      );

      const client = await getOnchainActor(ChainType.Evm).publicClient(caip2Id);
      const latest = await client.getBlockNumber();
      const logs = await client.getLogs({
        address: getAddress(ctx.paymentRequirements.asset),
        event: AuthorizationUsedEvent,
        args: {
          authorizer: getAddress(authorization.from),
          nonce: authorization.nonce as Hex,
        },
        fromBlock:
          latest > AuthorizationLookbackBlocks
            ? latest - AuthorizationLookbackBlocks
            : 0n,
        toBlock: latest,
      });

      for (const log of logs) {
        if (
          log.transactionHash &&
          (await this.paysAuthorization(caip2Id, log.transactionHash, ctx))
        ) {
          return log.transactionHash;
        }
      }
    } catch {
      // not found this time; a later retry looks again.
    }

    return null;
  };

  private resolveReservation = async (
    ctx: ValidatedPayment,
    holdsLease: boolean,
  ): Promise<
    | { kind: "settled"; transactionHash: string }
    | { kind: "pending"; transactionHash?: string }
    | { kind: "unpaid" }
  > => {
    const caip2Id = ctx.payment.transfer.quote.chain.caip2Id;
    const row = await db.query.transfer.findFirst({
      where: eq(transfer.id, ctx.payment.transfer.id),
    });

    if (!row || row.x402AuthorizationNonce !== ctx.payment.nonce) {
      return {
        kind: "unpaid",
      };
    }

    if (row.x402BlockchainHash) {
      const paid = await this.paysAuthorization(
        caip2Id,
        row.x402BlockchainHash,
        ctx,
      );

      if (paid) {
        return {
          kind: "settled",
          transactionHash: row.x402BlockchainHash,
        };
      }

      if (paid === null) {
        return {
          kind: "pending",
          transactionHash: row.x402BlockchainHash,
        };
      }
    }

    if (row.x402SettlementCallId) {
      const onchainActor = getOnchainActor(ChainType.Evm);
      const status = await onchainActor
        .getTransactionStatus(caip2Id, row.x402SettlementCallId, {
          variables: await new KvService().getSdkOptionVariables(),
        })
        .catch((): OnchainActorCallStatus => ({ status: "pending" }));

      if (status.status === "pending") {
        return {
          kind: "pending",
        };
      }

      if (status.status === "success") {
        const paid = await this.paysAuthorization(
          caip2Id,
          status.transactionHash,
          ctx,
        );

        if (paid) {
          return {
            kind: "settled",
            transactionHash: status.transactionHash,
          };
        }

        if (paid === null) {
          return {
            kind: "pending",
            transactionHash: status.transactionHash,
          };
        }
      }
    }

    const used = await new TokenService().isAuthorizationUsed(
      caip2Id,
      ctx.paymentRequirements.asset,
      ctx.payment.payer,
      ctx.payment.nonce,
    );

    if (used === null) {
      return {
        kind: "pending",
      };
    }

    if (used) {
      const transactionHash = await this.findAuthorizationTransaction(
        caip2Id,
        ctx,
      );

      return transactionHash
        ? { kind: "settled", transactionHash }
        : { kind: "pending" };
    }

    if (
      !holdsLease &&
      row.x402LeaseExpiresAt &&
      row.x402LeaseExpiresAt > new Date()
    ) {
      return {
        kind: "pending",
      };
    }

    await this.clearReservation(row.id, ctx.payment.nonce);

    return {
      kind: "unpaid",
    };
  };

  private acceptSettlement = async (
    ctx: ValidatedPayment,
    transactionHash: string,
  ): Promise<SettleResponse> => {
    const transferId = ctx.payment.transfer.id;
    const caip2Id = ctx.payment.transfer.quote.chain.caip2Id;

    const [accepted] = await db
      .update(transfer)
      .set({
        x402BlockchainHash: transactionHash,
        x402LeaseExpiresAt: null,
        x402SettledAt: sql`coalesce(${transfer.x402SettledAt}, now())`,
      })
      .where(
        and(
          eq(transfer.id, transferId),
          eq(transfer.x402AuthorizationNonce, ctx.payment.nonce),
        ),
      )
      .returning({ status: transfer.status });

    if (accepted?.status === TransferStatus.AwaitingDeposit) {
      await new TransferService().transitionTransferStatus(
        transferId,
        TransferStatus.AwaitingDeposit,
        TransferStatus.x402Settled,
        "x402 authorization settled",
      );
    }

    await Scheduler.enqueueSettle(transferId);

    return {
      success: true,
      payer: ctx.payment.payer,
      transaction: transactionHash,
      network: caip2Id,
    };
  };

  private pendingResponse = (
    ctx: ValidatedPayment,
    transactionHash?: string,
  ): SettleResponse => {
    return {
      success: false,
      errorReason: "settlement_pending",
      errorMessage:
        "The payment was submitted but isn't confirmed yet; retry settle with the same payload",
      payer: ctx.payment.payer,
      transaction: transactionHash ?? "",
      network: ctx.payment.transfer.quote.chain.caip2Id,
    };
  };

  x402SettlementDeadline = (expiresAt: Date) => {
    return (
      Math.floor(expiresAt.getTime() / 1000) - x402_SettlementReserveSeconds
    );
  };

  x402MaxTimeoutSeconds = (expiresAt: Date, now = Date.now()) => {
    return Math.min(
      x402_MaxTimeoutSeconds,
      this.x402SettlementDeadline(expiresAt) -
        x402_SettlementReserveSeconds -
        Math.ceil(now / 1000),
    );
  };

  getSupported = async () => {
    const kinds: Array<{
      x402Version: number;
      scheme: string;
      network: string;
      extra?: Record<string, unknown>;
    }> = [];

    const chains = await new ChainService().getActiveChains();

    for (const chain of chains) {
      if (!chain.config) {
        continue;
      }

      const tokens = await new TokenService().getTokensByChainId(chain.id);
      for (const token of tokens) {
        if (!token.supportsEIP3009 || !token.version) {
          continue;
        }

        kinds.push({
          x402Version: 2,
          scheme: "exact",
          network: chain.caip2Id,
          extra: {
            asset: token.address,
            name: token.name,
            version: token.version,
          },
        });
      }
    }

    return {
      kinds,
      extensions: [],
      signers: {
        "eip155:*": [getOnchainActor(ChainType.Evm).getAddress()],
      },
    };
  };

  createTransfer = async (appId: string, quoteId: string) => {
    const operatorAddress = getOnchainActor(ChainType.Evm).getAddress();
    return new TransferService().createTransfer(
      appId,
      quoteId,
      operatorAddress,
    );
  };

  getPaymentRequirements = async (appId: string, transferId: string) => {
    const transfer_ = await new TransferService().getTransfer(
      appId,
      transferId,
    );

    if (!transfer_) {
      throw new NotFoundError("transfer", transferId);
    }

    if (transfer_.status !== TransferStatus.AwaitingDeposit) {
      throw new PreconditionError("Transfer is not awaiting a deposit");
    }

    if (transfer_.quote.expiresAt.getTime() <= Date.now()) {
      throw new QuoteExpiredError(transfer_.quote.id);
    }

    const caip2Id = transfer_.quote.chain.caip2Id;
    await this.facilitatorFor(caip2Id);

    const maxTimeoutSeconds = this.x402MaxTimeoutSeconds(
      transfer_.quote.expiresAt,
    );

    if (maxTimeoutSeconds < x402_MinTimeoutSeconds) {
      throw new PreconditionError(
        "The quote expires too soon to take an x402 payment; create a new quote",
      );
    }

    const domain = await new TokenService().readTokenDomain(
      caip2Id,
      transfer_.quote.sourceToken.address,
    );

    if (!domain) {
      throw new PreconditionError(
        "Source token doesn't support EIP-3009 transfers",
      );
    }

    return {
      scheme: "exact" as const,
      network: caip2Id,
      asset: transfer_.quote.sourceToken.address,
      amount: transfer_.quote.sourceAmount.toString(),
      payTo: transfer_.payinAddress,
      maxTimeoutSeconds,
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
  ): Promise<VerifyResponse> => {
    const ctx = await this.validatePayment(
      appId,
      paymentPayload,
      paymentRequirements,
    );

    const facilitator = await this.facilitatorFor(
      ctx.payment.transfer.quote.chain.caip2Id,
    );

    return facilitator.verify(ctx.paymentPayload, ctx.paymentRequirements);
  };

  settle = async (
    appId: string,
    paymentPayload: PaymentPayload,
    paymentRequirements: PaymentRequirements,
    beforeNewPayment?: () => Promise<void>,
  ): Promise<SettleResponse> => {
    const ctx = await this.validatePayment(
      appId,
      paymentPayload,
      paymentRequirements,
      true,
    );

    const transfer_ = ctx.payment.transfer;
    const caip2Id = transfer_.quote.chain.caip2Id;
    const facilitator = await this.facilitatorFor(caip2Id);

    if (ctx.payment.matchesReservation) {
      const outcome = await this.resolveReservation(ctx, false);
      if (outcome.kind === "settled") {
        return this.acceptSettlement(ctx, outcome.transactionHash);
      }

      if (outcome.kind === "pending") {
        return this.pendingResponse(ctx, outcome.transactionHash);
      }

      const latest = await new TransferService().getTransfer(
        appId,
        transfer_.id,
      );

      if (!latest) {
        throw new NotFoundError("transfer", transfer_.id);
      }

      this.assertCanTakePayment(latest, ctx.payment.authorization.validBefore);
    }

    await beforeNewPayment?.();

    const verification = await facilitator.verify(
      ctx.paymentPayload,
      ctx.paymentRequirements,
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

    if (!(await this.reserve(transfer_.id, ctx))) {
      throw new PreconditionError(
        "Another x402 settlement is already in progress for this transfer",
      );
    }

    const reservation = and(
      eq(transfer.id, transfer_.id),
      eq(transfer.x402AuthorizationNonce, ctx.payment.nonce),
    );

    let result: SettleResponse | undefined;
    let failure: unknown;

    try {
      result = await withX402Observer(
        {
          onSubmitted: async (callId) => {
            await db
              .update(transfer)
              .set({ x402SettlementCallId: callId })
              .where(reservation);
          },
          onBroadcast: async (transactionHash) => {
            await db
              .update(transfer)
              .set({ x402BlockchainHash: transactionHash })
              .where(and(reservation, isNull(transfer.x402BlockchainHash)));
          },
        },
        () => facilitator.settle(ctx.paymentPayload, ctx.paymentRequirements),
      );
    } catch (error) {
      failure = error;
    }

    if (result?.success) {
      return this.acceptSettlement(ctx, result.transaction);
    }

    const outcome = await this.resolveReservation(ctx, true);

    if (outcome.kind === "settled") {
      return this.acceptSettlement(ctx, outcome.transactionHash);
    }

    if (outcome.kind === "pending") {
      return this.pendingResponse(
        ctx,
        outcome.transactionHash ?? result?.transaction,
      );
    }

    if (failure || !result) throw failure;
    return result;
  };
}
