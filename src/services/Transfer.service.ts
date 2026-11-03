import { formatUnits, getAddress, zeroAddress, type Hex } from "viem";
import {
  chainConfig,
  customer,
  event,
  quote,
  quoteFee,
  transfer,
  transferTimeline,
  deposit,
  payout,
} from "../db/schema";
import {
  AppError,
  NotFoundError,
  PreconditionError,
  QuoteExpiredError,
  TransferStructMismatchError,
} from "../shared/errors";
import {
  CancelledTransferWatchSeconds,
  ChainType,
  OneMinute,
  PayoutDeadlineMarginSeconds,
  Provider,
  SettleableTransferStatuses,
  TerminalTransferStatuses,
  TransferStatus,
  WebhookCategory,
} from "../shared/constants";
import {
  paginate,
  searchPattern,
  type WithPageInput,
} from "../shared/pagination";
import { db, dbWithTransaction, type DatabaseOrTransaction } from "../db";
import {
  and,
  asc,
  count,
  desc,
  eq,
  ilike,
  inArray,
  isNull,
  or,
  sql,
} from "drizzle-orm";
import { OperatorForwardService } from "./OperatorForward.service";
import { type OnchainNotifier } from "../sdks/interfaces/OnchainNotifier";
import { PaymentLinkService } from "./PaymentLink.service";
import { runProviderMethod } from "../shared/providers";
import { getNearActor, getOnchainActor } from "../shared/onchainActor";
import {
  kiteNear,
  NearDepositReserve,
  NearNativeToken,
  type NearKiteStatus,
  type NearKiteTransfer,
} from "../shared/kiteNearContract";
import { PayoutService } from "./Payout.service";
import { ChainService } from "./Chain.service";
import { TokenService } from "./Token.service";
import { QuoteService } from "./Quote.service";
import { KvService } from "./Kv.service";
import { Scheduler } from "../shared/scheduler";
import { getChain, getEvmChain, getNearChain } from "../shared/chains";
import { common } from "../shared/common";
import { kite } from "../shared/kiteContract";
import { omit } from "lodash";

type PrepareTransferInput = {
  transferId: string;
  quote: {
    sourceAmount: bigint;
    expiresAt: Date;
    uniswapPoolFeeTier: number | null;
    swapPool: string | null;
    sourceToken: { id: string; address: string };
    targetToken: { id: string; address: string };
    fees: Array<{ id: string; feeAddress: string; amount: bigint }>;
    chain: { caip2Id: Caip2Id };
  };
  config: typeof chainConfig.$inferSelect;
  settlementRecipient: string;
  refundAddress: string;
  minAmountOut: bigint;
};

type PreparedTransfer = {
  kiteTransferInput: unknown;
  payinAddress: string;
  trackedBy: Provider[];
  refundAddress: string;
  settlementRecipient: string;
};

/** Gas for a factory call that runs the deposit's steps: the most a transaction can attach. */
const NearFactoryCallGas = 300_000_000_000_000n;
const NearDeployGas = 100_000_000_000_000n;
const NearRegisterGas = 10_000_000_000_000n;

export class TransferService {
  private sdkOptions = async (): Promise<SdkOptions> => {
    return {
      variables: await new KvService().getSdkOptionVariables(),
    };
  };

  private callbackSourceId = (item: OnchainNotifierCallbackResultItem) => {
    return `${item.caip2Id}/${item.blockchainHash.toLowerCase()}/${item.logIndex}/${item.type}`;
  };

  private loadTransfer = (
    transferId: string,
    executor: DatabaseOrTransaction = db,
  ) => {
    return executor.query.transfer.findFirst({
      where: eq(transfer.id, transferId),
      with: {
        quote: {
          with: {
            sourceToken: true,
            targetToken: true,
            chain: {
              with: {
                config: true,
              },
            },
          },
        },
      },
    });
  };

  private getOnchainTransfer = async (transferId: string) => {
    const row = await this.loadTransfer(transferId);
    if (!row) {
      throw new NotFoundError("transfer", transferId);
    }

    const config = row.quote.chain.config;
    if (!config) {
      throw new AppError("Selected chain is not configured");
    }

    const caip2Id = row.quote.chain.caip2Id;
    const onchainActor = getOnchainActor(getChain(caip2Id).type);
    const client = await onchainActor.publicClient(
      caip2Id,
      config.rpcUrls ?? [],
    );

    const struct = kite.deserializeTransferInput(row.kiteTransferInput);
    const predictedAddress = await kite.predictAddress(
      client,
      config.kiteFactoryAddress,
      struct,
    );

    if (!common.isSameAddress(predictedAddress, row.payinAddress)) {
      throw new TransferStructMismatchError(
        row.id,
        row.payinAddress,
        predictedAddress,
      );
    }

    return {
      row,
      caip2Id,
      factoryAddress: config.kiteFactoryAddress,
      struct,
      client,
      onchainActor,
    };
  };

  private sendFactoryCall = async (
    ctx: Awaited<ReturnType<TransferService["getOnchainTransfer"]>>,
    data: Hex,
    useGasSponsor = true,
  ) => {
    const options = await this.sdkOptions();
    const transactionHash = await ctx.onchainActor.sendTransaction(
      { caip2Id: ctx.caip2Id, to: ctx.factoryAddress, data, value: 0n },
      options,
      { useGasSponsor },
    );

    return ctx.onchainActor.waitForReceipt(ctx.caip2Id, transactionHash);
  };

  private triggerCallbackFromReceipt = async (
    caip2Id: Caip2Id,
    payinAddress: string,
    receipt: OnchainActorReceipt,
  ) => {
    const items = kite
      .parseContractLogs(
        caip2Id,
        receipt.logs.map((log) => ({
          ...log,
          logIndex: String(log.logIndex),
          transactionHash: log.transactionHash ?? receipt.transactionHash,
        })),
      )
      .filter((item) => common.isSameAddress(item.payinAddress, payinAddress));

    await this.handleOnchainNotifierCallback(items);
  };

  private trackAddress = async (
    caip2Id: Caip2Id,
    address: string,
    providers: Provider[],
  ): Promise<Provider[]> => {
    if (!providers.length) {
      return [];
    }

    const options = await this.sdkOptions();

    // each activity is watched by the first provider that accepts it
    const firstAccepting = async (
      track: (provider: Provider) => Promise<unknown>,
    ) => {
      let error: unknown;

      for (const provider of providers) {
        try {
          await track(provider);
          return provider;
        } catch (e) {
          error = e;
        }
      }

      throw error;
    };

    const trackedBy = await Promise.all([
      firstAccepting((provider) =>
        runProviderMethod<OnchainNotifier, "trackAddressActivity">(
          [provider],
          "trackAddressActivity",
          { caip2Id, address },
          options,
        ),
      ),
      firstAccepting((provider) =>
        runProviderMethod<OnchainNotifier, "trackKiteContractEvent">(
          [provider],
          "trackKiteContractEvent",
          { caip2Id, contractAddress: address },
          options,
        ),
      ),
    ]);

    return [...new Set(trackedBy)];
  };

  private abandonSettlement = async (
    row: {
      id: string;
      status: TransferStatus;
      x402SettledAt: Date | null;
    },
    reason: string,
    balance: bigint,
  ) => {
    if (row.x402SettledAt) {
      await this.transitionTransferStatus(
        row.id,
        row.status,
        TransferStatus.Failed,
        `Settlement failed (${reason}); funds held for manual resolution because the x402 payment was accepted`,
      );

      return;
    }

    if (balance === 0n) {
      await this.transitionTransferStatus(
        row.id,
        row.status,
        TransferStatus.Cancelled,
        "Transfer expired without payment",
      );

      return;
    }

    await db.transaction(async (transaction) => {
      const moved = await this.transitionTransferStatus(
        row.id,
        row.status,
        TransferStatus.Failed,
        `Settlement failed (${reason})`,
        undefined,
        transaction,
      );

      if (moved)
        await Scheduler.enqueueRefund(row.id, dbWithTransaction(transaction));
    });
  };

  private reconcileClosedTransfer = async (
    ctx: { row: { id: string; status: TransferStatus; payinAddress: string } },
    status: string | null,
  ) => {
    if (status === "Settled") {
      await this.transitionTransferStatus(
        ctx.row.id,
        ctx.row.status,
        TransferStatus.Settled,
        "Transfer settled",
      );
    } else if (status === "Refunded") {
      await this.transitionTransferStatus(
        ctx.row.id,
        ctx.row.status,
        TransferStatus.Refunded,
        "Transfer refunded",
      );
    } else {
      throw new AppError(
        `Transfer ${ctx.row.id} is ${status} on-chain; expected it to be closed`,
      );
    }

    await this.enqueueLeftoverRecovery(ctx.row.id);
  };

  private enqueueLeftoverRecovery = async (transferId: string) => {
    const row = await db.query.transfer.findFirst({
      where: eq(transfer.id, transferId),
      with: {
        quote: {
          with: {
            sourceToken: true,
            targetToken: true,
          },
        },
        deposits: {
          with: {
            token: true,
          },
        },
      },
    });

    if (!row) {
      return;
    }

    const tokens = new Set(
      [
        row.quote.sourceToken.address,
        row.quote.targetToken.address,
        ...row.deposits.map((d) => d.token.address),
      ].map((address) => common.normalizeAddress(address)),
    );

    for (const tokenAddress of tokens) {
      await Scheduler.enqueueRecover(transferId, tokenAddress);
    }
  };

  private recoverToken = async (
    transferId: string,
    tokenAddress: string,
    destinationAddress: string,
    useGasSponsor = true,
  ) => {
    if (await this.isNearTransfer(transferId)) {
      return this.recoverNearToken(
        transferId,
        tokenAddress,
        destinationAddress,
      );
    }

    const ctx = await this.getOnchainTransfer(transferId);
    const balance = await ctx.onchainActor.getBalance(
      ctx.caip2Id,
      tokenAddress,
      ctx.row.payinAddress,
    );

    if (balance === 0n) {
      return {
        status: "empty",
      } as const;
    }

    const data = kite.factory.recover(
      ctx.struct,
      tokenAddress,
      destinationAddress,
    );

    const simulation = await kite.simulateFactoryCall(
      ctx.client,
      ctx.factoryAddress,
      ctx.onchainActor.getAddress(),
      data,
    );

    if (!simulation.ok) {
      return {
        status: "failed",
        failure: simulation,
      } as const;
    }

    const receipt = await this.sendFactoryCall(ctx, data, useGasSponsor);

    await this.triggerCallbackFromReceipt(
      ctx.caip2Id,
      ctx.row.payinAddress,
      receipt,
    );

    return {
      status: "sent",
    } as const;
  };

  transitionTransferStatus = async (
    transferId: string,
    previousStatus: TransferStatus,
    currentStatus: TransferStatus,
    description: string,
    extra?: {
      settlementBlockchainHash?: string;
      refundBlockchainHash?: string;
    },
    executor: DatabaseOrTransaction = db,
  ) => {
    if (previousStatus === currentStatus) {
      return false;
    }

    return executor.transaction(async (transaction) => {
      const [updated] = await transaction
        .update(transfer)
        .set({
          status: currentStatus,
          ...(currentStatus === TransferStatus.Settled &&
          extra?.settlementBlockchainHash
            ? { settlementBlockchainHash: extra.settlementBlockchainHash }
            : {}),
          ...(currentStatus === TransferStatus.Refunded &&
          extra?.refundBlockchainHash
            ? { refundBlockchainHash: extra.refundBlockchainHash }
            : {}),
        })
        .where(
          and(eq(transfer.id, transferId), eq(transfer.status, previousStatus)),
        )
        .returning({ appId: transfer.appId });

      if (!updated) {
        return false;
      }

      const transfer_ = await transaction.query.transfer.findFirst({
        where: eq(transfer.id, transferId),
        columns: { trackedBy: false },
        with: {
          quote: {
            with: {
              sourceToken: true,
              targetToken: true,
              chain: true,
              fees: true,
              customer: true,
              paymentLink: true,
            },
          },
        },
      });

      const [createdEvent] = await transaction
        .insert(event)
        .values({
          appId: updated.appId,
          category: WebhookCategory.Transfer,
          previousCategoryStatus: previousStatus,
          currentCategoryStatus: currentStatus,
          data: common.serializeData(transfer_),
        })
        .returning({ id: event.id });

      await transaction.insert(transferTimeline).values({
        eventId: createdEvent.id,
        transferId,
        description,
      });

      await Scheduler.enqueueEvent(
        updated.appId,
        createdEvent.id,
        dbWithTransaction(transaction),
      );

      if (TerminalTransferStatuses.includes(currentStatus)) {
        await Scheduler.enqueueUntrack(
          transferId,
          currentStatus === TransferStatus.Cancelled
            ? CancelledTransferWatchSeconds
            : 0,
          dbWithTransaction(transaction),
        );
      }

      if (currentStatus === TransferStatus.Settled) {
        const paidOut = await transaction.query.payout.findFirst({
          where: eq(payout.transferId, transferId),
          columns: { transferId: true },
        });

        if (paidOut) {
          await Scheduler.enqueueCheckPayout(
            transferId,
            dbWithTransaction(transaction),
          );
        }
      }

      return true;
    });
  };

  untrackTransfer = async (transferId: string) => {
    const row = await this.loadTransfer(transferId);
    if (!row) return;

    const caip2Id = row.quote.chain.caip2Id;
    const address = row.payinAddress;
    const options = await this.sdkOptions();

    for (const provider of row.trackedBy) {
      await runProviderMethod<OnchainNotifier, "untrackAddressActivity">(
        [provider],
        "untrackAddressActivity",
        { caip2Id, address },
        options,
      );
      await runProviderMethod<OnchainNotifier, "untrackKiteContractEvent">(
        [provider],
        "untrackKiteContractEvent",
        { caip2Id, contractAddress: address },
        options,
      );

      await db
        .update(transfer)
        .set({
          trackedBy: sql`array_remove(${transfer.trackedBy}, ${provider})`,
        })
        .where(eq(transfer.id, transferId));
    }
  };

  createDeposit = async (
    input: typeof deposit.$inferInsert,
    appId: string,
    transferId: string,
    sourceId: string,
  ) => {
    return db.transaction(async (transaction) => {
      const [row] = await transaction
        .insert(deposit)
        .values(input)
        .onConflictDoNothing()
        .returning();

      if (!row) {
        return false;
      }

      const [createdEvent] = await transaction
        .insert(event)
        .values({
          appId,
          category: WebhookCategory.Deposit,
          currentCategoryStatus: "Completed",
          sourceId,
          data: common.serializeData({ ...row, transferId }),
        })
        .onConflictDoNothing()
        .returning({ id: event.id });

      if (createdEvent) {
        await Scheduler.enqueueEvent(
          appId,
          createdEvent.id,
          dbWithTransaction(transaction),
        );
      }

      return true;
    });
  };

  getDepositsByAddress = async (address: string) => {
    return await db.query.deposit.findMany({
      where: eq(deposit.address, address),
      orderBy: desc(deposit.createdAt),
    });
  };

  private prepareEvmTransfer = async (
    input: PrepareTransferInput,
  ): Promise<PreparedTransfer> => {
    const { quote: quote_, config } = input;
    const caip2Id = quote_.chain.caip2Id;
    const chain = getEvmChain(caip2Id);
    const onchainActor = getOnchainActor(chain.type);
    const settlementRecipient = getAddress(input.settlementRecipient);

    const isSameToken = quote_.sourceToken.id === quote_.targetToken.id;
    const router =
      quote_.uniswapPoolFeeTier === 0
        ? chain.contracts.Uniswap?.UniswapV2Router02
        : chain.contracts.Uniswap?.SwapRouter02;
    if (!isSameToken && !router)
      throw new AppError("This chain has no swap router");

    const client = await onchainActor.publicClient(
      caip2Id,
      config.rpcUrls ?? [],
    );

    const struct = kite.buildTransferInput({
      transferId: input.transferId,
      payInTokenAddress: quote_.sourceToken.address,
      amountIn: quote_.sourceAmount,
      settlementTokenAddress: quote_.targetToken.address,
      settlementRecipient,
      minAmountOut: input.minAmountOut,
      fees: quote_.fees.map((fee) => ({
        id: fee.id,
        recipient: fee.feeAddress,
        amount: fee.amount,
      })),
      refundAddress: input.refundAddress,
      expiresAt: quote_.expiresAt,
      routerAddress: isSameToken || !router ? zeroAddress : router,
      poolFeeTier: quote_.uniswapPoolFeeTier ?? 0,
      implementation: await kite.getImplementation(
        client,
        config.kiteFactoryAddress,
      ),
    });

    const error = kite.validateTransferInput(struct);
    if (error) throw new AppError(error);

    const deployment = await kite.simulateFactoryCall(
      client,
      config.kiteFactoryAddress,
      onchainActor.getAddress(),
      kite.factory.deploy(struct),
    );

    if (!deployment.ok) {
      throw new AppError(
        deployment.kind === "revert"
          ? (deployment.errorName ?? deployment.message)
          : deployment.message,
      );
    }

    const payinAddress = await kite.predictAddress(
      client,
      config.kiteFactoryAddress,
      struct,
    );

    const trackedBy = await this.trackAddress(
      caip2Id,
      payinAddress,
      config.onchainNotifierProviders ?? [],
    );

    return {
      kiteTransferInput: kite.serializeTransferInput(struct),
      payinAddress,
      trackedBy,
      refundAddress: struct.refundAddress,
      settlementRecipient,
    };
  };

  /**
   * A NEP-141 token only sends to accounts registered on it, so on NEAR the deposit account is
   * created now, registered on the tokens it will hold, rather than when it settles.
   */
  private prepareNearTransfer = async (
    input: PrepareTransferInput,
  ): Promise<PreparedTransfer> => {
    const { quote: quote_, config } = input;
    const caip2Id = quote_.chain.caip2Id;
    const chain = getNearChain(caip2Id);
    const actor = getNearActor();
    const rpcUrls = config.rpcUrls ?? [];
    const factory = config.kiteFactoryAddress;

    const isSameToken = quote_.sourceToken.id === quote_.targetToken.id;
    const dcl = chain.contracts.Rhea?.dcl;
    if (!isSameToken && (!dcl || !quote_.swapPool))
      throw new AppError("This chain has no swap route for this token");

    const implementation = await actor.view<string>(
      caip2Id,
      factory,
      "implementation",
      {},
      rpcUrls,
    );

    const struct = kiteNear.buildTransferInput({
      transferId: input.transferId,
      payInToken: quote_.sourceToken.address,
      amountIn: quote_.sourceAmount,
      settlementToken: quote_.targetToken.address,
      settlementRecipient: input.settlementRecipient,
      minAmountOut: input.minAmountOut,
      fees: quote_.fees.map((fee) => ({
        id: fee.id,
        recipient: fee.feeAddress,
        amount: fee.amount,
      })),
      refundAccount: input.refundAddress,
      expiresAt: quote_.expiresAt,
      swap:
        isSameToken || !dcl || !quote_.swapPool
          ? null
          : {
              router: dcl,
              pool: { Dcl: quote_.swapPool },
              wrap: chain.contracts.wrapNear,
            },
      implementation,
    });

    const error = kiteNear.validateTransferInput(struct);
    if (error) throw new AppError(error);

    const payinAddress = kiteNear.predictAddress(factory, struct);
    const derived = await actor.view<string>(
      caip2Id,
      factory,
      "predict_address",
      { transfer: struct },
      rpcUrls,
    );
    if (derived !== payinAddress) {
      throw new AppError(
        `kite-factory derives ${derived} for this transfer, not ${payinAddress}`,
      );
    }

    const deposit = await actor.view<string>(
      caip2Id,
      factory,
      "deploy_deposit",
      { transfer: struct },
      rpcUrls,
    );

    const result = await actor.functionCall(
      caip2Id,
      {
        contractId: factory,
        method: "deploy",
        args: { transfer: struct },
        deposit: BigInt(deposit),
        gas: NearDeployGas,
      },
      rpcUrls,
    );

    if (result.status !== "success") {
      throw new AppError(
        `Could not create the deposit account: ${result.failure ?? "unknown error"}`,
      );
    }

    return {
      kiteTransferInput: struct,
      payinAddress,
      trackedBy: [],
      refundAddress: input.refundAddress,
      settlementRecipient: input.settlementRecipient,
    };
  };

  private isNearTransfer = async (transferId: string) => {
    const row = await this.loadTransfer(transferId);
    return !!row && getChain(row.quote.chain.caip2Id).type === ChainType.Near;
  };

  private getNearTransfer = async (transferId: string) => {
    const row = await this.loadTransfer(transferId);
    if (!row) throw new NotFoundError("transfer", transferId);

    const config = row.quote.chain.config;
    if (!config) throw new AppError("Selected chain is not configured");

    const struct = row.kiteTransferInput as unknown as NearKiteTransfer;
    const predicted = kiteNear.predictAddress(
      config.kiteFactoryAddress,
      struct,
    );
    if (predicted !== row.payinAddress) {
      throw new TransferStructMismatchError(
        row.id,
        row.payinAddress,
        predicted,
      );
    }

    return {
      row,
      caip2Id: row.quote.chain.caip2Id,
      factory: config.kiteFactoryAddress,
      rpcUrls: config.rpcUrls ?? [],
      struct,
      actor: getNearActor(),
    };
  };

  /** What a NEAR deposit account holds of a token, leaving out its own reserve. */
  private nearBalance = async (
    ctx: Awaited<ReturnType<TransferService["getNearTransfer"]>>,
    token: string,
  ) => {
    const balance = await ctx.actor.getBalance(
      ctx.caip2Id,
      token,
      ctx.row.payinAddress,
    );

    if (token !== NearNativeToken) return balance;
    return balance > NearDepositReserve ? balance - NearDepositReserve : 0n;
  };

  private nearStatus = async (
    ctx: Awaited<ReturnType<TransferService["getNearTransfer"]>>,
  ) => {
    if (
      !(await ctx.actor.accountExists(
        ctx.caip2Id,
        ctx.row.payinAddress,
        ctx.rpcUrls,
      ))
    ) {
      return null;
    }

    return ctx.actor.view<NearKiteStatus>(
      ctx.caip2Id,
      ctx.row.payinAddress,
      "get_status",
      {},
      ctx.rpcUrls,
    );
  };

  private sendNearFactoryCall = async (
    ctx: Awaited<ReturnType<TransferService["getNearTransfer"]>>,
    method: "settle" | "refund" | "recover",
    args: Record<string, unknown> = {},
  ) => {
    const result = await ctx.actor.functionCall(
      ctx.caip2Id,
      {
        contractId: ctx.factory,
        method,
        args: { transfer: ctx.struct, ...args },
        gas: NearFactoryCallGas,
      },
      ctx.rpcUrls,
    );

    const parsed = kiteNear.parseEvents(ctx.caip2Id, result.outcome);
    await this.handleOnchainNotifierCallback(
      parsed.items.filter((item) => item.payinAddress === ctx.row.payinAddress),
    );

    return { ...result, stopped: parsed.stopped };
  };

  /** Fee recipients and the settlement recipient must be registered on the settlement token. */
  private registerNearRecipients = async (
    ctx: Awaited<ReturnType<TransferService["getNearTransfer"]>>,
  ) => {
    const token = kiteNear.settlementToken(ctx.struct);
    if (token === NearNativeToken) return;

    const accounts = [
      ...new Set([
        ctx.struct.settlement_recipient,
        ...ctx.struct.fees.map((fee) => fee.recipient),
      ]),
    ];

    const unregistered: string[] = [];
    for (const account of accounts) {
      const balance = await ctx.actor.view<unknown>(
        ctx.caip2Id,
        token,
        "storage_balance_of",
        { account_id: account },
        ctx.rpcUrls,
      );
      if (!balance) unregistered.push(account);
    }

    if (!unregistered.length) return;

    const bounds = await ctx.actor.view<{ min: string }>(
      ctx.caip2Id,
      token,
      "storage_balance_bounds",
      {},
      ctx.rpcUrls,
    );

    const result = await ctx.actor.functionCall(
      ctx.caip2Id,
      unregistered.map((account) => ({
        contractId: token,
        method: "storage_deposit",
        args: { account_id: account, registration_only: true },
        deposit: BigInt(bounds.min),
        gas: NearRegisterGas,
      })),
      ctx.rpcUrls,
    );

    if (result.status !== "success") {
      throw new AppError(
        `Could not register ${unregistered.join(", ")} on ${token}: ${result.failure}`,
      );
    }
  };

  private settleNearTransfer = async (transferId: string) => {
    const ctx = await this.getNearTransfer(transferId);
    let row = ctx.row;

    if (!SettleableTransferStatuses.includes(row.status)) {
      return;
    }

    const status = await this.nearStatus(ctx);
    if (status === "Settled" || status === "Refunded") {
      return this.reconcileClosedTransfer(ctx, status);
    }

    if (status === null) {
      throw new AppError("The transfer's deposit account doesn't exist");
    }

    // a settlement that stopped after its swap resumes; nothing is checked again
    const resuming = status === "Executing";
    const amountIn = BigInt(ctx.struct.amount_in);
    const balance = await this.nearBalance(
      ctx,
      kiteNear.payInToken(ctx.struct),
    );

    if (!resuming) {
      const expired =
        BigInt(Math.floor(Date.now() / 1000)) > BigInt(ctx.struct.expires_at);

      if (balance < amountIn) {
        if (expired) {
          return this.abandonSettlement(
            row,
            "Transfer expired before it was paid in full",
            balance,
          );
        }

        if (row.status === TransferStatus.AwaitingDeposit) {
          return;
        }

        throw new AppError("Transfer is awaiting full deposit");
      }

      if (expired) {
        return this.abandonSettlement(
          row,
          "Transfer expired before it was settled",
          balance,
        );
      }

      const payout_ = await db.query.payout.findFirst({
        where: eq(payout.transferId, row.id),
        columns: { deadline: true },
      });

      if (
        payout_ &&
        payout_.deadline.getTime() - Date.now() <
          common.toMs(PayoutDeadlineMarginSeconds)
      ) {
        return this.abandonSettlement(
          row,
          "The NEAR Intents deposit address for the payout is about to expire",
          balance,
        );
      }
    }

    if (row.status !== TransferStatus.Processing) {
      const moved = await this.transitionTransferStatus(
        row.id,
        row.status,
        TransferStatus.Processing,
        "Transfer settlement submitted",
      );

      if (!moved) {
        return;
      }

      row = {
        ...row,
        status: TransferStatus.Processing,
      };
    }

    await this.registerNearRecipients(ctx);

    const result = await this.sendNearFactoryCall(ctx, "settle");
    if (result.status !== "success") {
      throw new AppError(`Settlement failed: ${result.failure}`);
    }

    const stop = result.stopped.at(-1);
    if (!stop) return;

    if (stop.status === "Open") {
      if (stop.reason.startsWith("InsufficientPayment")) {
        throw new AppError("Deposit not visible to the contract yet");
      }

      return this.abandonSettlement(row, stop.reason, balance);
    }

    throw new AppError(
      `Settlement stopped at ${stop.step} (${stop.reason}); it resumes on the next attempt`,
    );
  };

  private refundNearTransfer = async (
    transferId: string,
  ): Promise<{ refunded: true } | { refunded: false; reason: string }> => {
    const ctx = await this.getNearTransfer(transferId);
    const row = ctx.row;

    const closed = this.closedReason(row);
    if (closed) return { refunded: false, reason: closed };

    const status = await this.nearStatus(ctx);
    if (status === "Settled" || status === "Refunded") {
      await this.reconcileClosedTransfer(ctx, status);
      return {
        refunded: false,
        reason: "The transfer has already closed on-chain",
      };
    }

    if (status === "Executing") {
      throw new AppError("The transfer is settling; it can't be refunded now");
    }

    const progress =
      status === "Open"
        ? await ctx.actor.view<{ wrapped: boolean }>(
            ctx.caip2Id,
            row.payinAddress,
            "get_progress",
            {},
            ctx.rpcUrls,
          )
        : null;

    const balance = await this.nearBalance(
      ctx,
      kiteNear.payInToken(ctx.struct),
    );

    // a swap that failed after wrapping native NEAR leaves the payment as wNEAR
    if (balance === 0n && !progress?.wrapped) {
      return {
        refunded: false,
        reason: `There is nothing to refund: the pay-in address holds no ${row.quote.sourceToken.symbol}`,
      };
    }

    const result = await this.sendNearFactoryCall(ctx, "refund");
    if (result.status !== "success") {
      throw new AppError(`Refund failed: ${result.failure}`);
    }

    return { refunded: true };
  };

  private recoverNearToken = async (
    transferId: string,
    tokenAddress: string,
    destinationAddress: string,
  ) => {
    const ctx = await this.getNearTransfer(transferId);
    const balance = await this.nearBalance(ctx, tokenAddress);

    if (balance === 0n) {
      return {
        status: "empty",
      } as const;
    }

    const revert = (errorName: string) =>
      ({
        status: "failed",
        failure: {
          ok: false,
          kind: "revert",
          errorName,
          message: errorName,
        },
      }) as const;

    const status = await this.nearStatus(ctx);
    if (status === "Executing") return revert("InvoiceNotOpen");

    const ownTokens = [
      kiteNear.payInToken(ctx.struct),
      kiteNear.settlementToken(ctx.struct),
    ];
    if (status === "Open" && ownTokens.includes(tokenAddress)) {
      return revert("RecoveryNotAllowed");
    }

    const result = await this.sendNearFactoryCall(ctx, "recover", {
      token: tokenAddress === NearNativeToken ? null : tokenAddress,
      destination:
        !destinationAddress || common.isZeroAddress(destinationAddress)
          ? null
          : destinationAddress,
    });

    if (result.status !== "success") {
      return {
        status: "failed",
        failure: {
          ok: false,
          kind: "revert",
          errorName: "Unknown",
          message: result.failure ?? "Recovery failed",
        },
      } as const;
    }

    return {
      status: "sent",
    } as const;
  };

  createTransfer = async (
    appId: string,
    quoteId: string,
    refundAddress: string,
  ) => {
    const result = await db
      .select({ count: count() })
      .from(transfer)
      .where(eq(transfer.quoteId, quoteId));

    const hasQuoteBeenUsed = result[0].count > 0;
    if (hasQuoteBeenUsed)
      throw new AppError("Quote has been consumed, create a new one");

    const quote_ = await db.query.quote.findFirst({
      where: and(eq(quote.id, quoteId), eq(quote.appId, appId)),
      with: {
        sourceToken: true,
        targetToken: true,
        paymentLink: true,
        fees: {
          orderBy: [asc(quoteFee.id)],
        },
        chain: {
          with: {
            config: true,
          },
        },
      },
    });

    if (!quote_) throw new NotFoundError("quote", quoteId);
    if (quote_.paymentLink)
      await new PaymentLinkService().assertPayable(quote_.paymentLink);
    if (quote_.expiresAt.getTime() <= Date.now())
      throw new QuoteExpiredError(quote_.id);

    const config = quote_.chain.config;
    if (!config) throw new AppError("Selected chain is not configured");

    const caip2Id = quote_.chain.caip2Id;
    const chain = getChain(caip2Id);
    if (!common.isValidAddress(chain.type, refundAddress))
      throw new AppError("The refund address is not a valid address");

    const settlement = await new PayoutService().planSettlement({
      appId,
      chainId: quote_.chain.id,
      caip2Id,
      slippageBps: config.slippageBps,
      settlementToken: quote_.targetToken,
      amount:
        quote_.targetAmount -
        quote_.fees.reduce((total, fee) => total + fee.amount, 0n),
    });

    const minAmountOut =
      (quote_.targetAmount * (10000n - BigInt(config.slippageBps))) / 10000n;
    const transferId = common.uuidv4();

    const prepare =
      chain.type === ChainType.Near
        ? this.prepareNearTransfer
        : this.prepareEvmTransfer;
    const prepared = await prepare({
      transferId,
      quote: quote_,
      config,
      settlementRecipient: common.normalizeAddressFor(
        chain.type,
        settlement.recipient,
      ),
      refundAddress: common.normalizeAddressFor(chain.type, refundAddress),
      minAmountOut,
    });

    const { payinAddress, trackedBy, settlementRecipient } = prepared;

    const paymentInstructions = {
      caip2Id,
      address: payinAddress,
      tokenAddress: quote_.sourceToken.address,
      amount: quote_.sourceAmount.toString(),
      expiresAt: quote_.expiresAt,
    };

    const saved = await db.transaction(async (transaction) => {
      const [inserted] = await transaction
        .insert(transfer)
        .values({
          id: transferId,
          appId,
          quoteId,
          settlementRecipient,
          minAmountOut,
          refundAddress: prepared.refundAddress,
          payinAddress,
          trackedBy,
          kiteTransferInput:
            prepared.kiteTransferInput as typeof transfer.$inferInsert.kiteTransferInput,
          status: TransferStatus.AwaitingDeposit,
        })
        .returning();
      const created = omit(inserted, ["trackedBy"]);

      if (settlement.payout) {
        await transaction
          .insert(payout)
          .values({ ...settlement.payout, transferId: created.id });
      }

      const [createdEvent] = await transaction
        .insert(event)
        .values({
          appId,
          category: WebhookCategory.Transfer,
          previousCategoryStatus: TransferStatus.Created,
          currentCategoryStatus: TransferStatus.AwaitingDeposit,
          data: common.serializeData({
            ...created,
            quote: {
              ...quote_,
              chain: {
                id: quote_.chain.id,
                caip2Id: quote_.chain.caip2Id,
                isActive: quote_.chain.isActive,
                createdAt: quote_.chain.createdAt,
                updatedAt: quote_.chain.updatedAt,
                deletedAt: quote_.chain.deletedAt,
              },
            },
            paymentInstructions,
          }),
        })
        .returning({ id: event.id });

      await transaction.insert(transferTimeline).values({
        transferId: created.id,
        eventId: createdEvent.id,
        description: [
          "Transfer created; awaiting deposit",
          settlement.description,
        ]
          .filter(Boolean)
          .join(". "),
      });

      await Scheduler.enqueueEvent(
        appId,
        createdEvent.id,
        dbWithTransaction(transaction),
      );

      return created;
    });

    return {
      ...saved,
      paymentInstructions,
    };
  };

  settleTransfer = async (transferId: string) => {
    if (await this.isNearTransfer(transferId)) {
      return this.settleNearTransfer(transferId);
    }

    const ctx = await this.getOnchainTransfer(transferId);
    let row = ctx.row;

    if (!SettleableTransferStatuses.includes(row.status)) {
      return;
    }

    const balance = await ctx.onchainActor.getBalance(
      ctx.caip2Id,
      ctx.struct.payInTokenAddress,
      row.payinAddress,
    );

    const expired =
      BigInt(Math.floor(Date.now() / 1000)) > ctx.struct.expiresAt;

    if (balance < ctx.struct.amountIn) {
      if (expired) {
        return this.abandonSettlement(
          row,
          "Transfer expired before it was paid in full",
          balance,
        );
      }

      if (row.status === TransferStatus.AwaitingDeposit) {
        return;
      }

      throw new AppError("Transfer is awaiting full deposit");
    }

    if (expired) {
      return this.abandonSettlement(
        row,
        "Transfer expired before it was settled",
        balance,
      );
    }

    const payout_ = await db.query.payout.findFirst({
      where: eq(payout.transferId, row.id),
      columns: { deadline: true },
    });

    if (
      payout_ &&
      payout_.deadline.getTime() - Date.now() <
        common.toMs(PayoutDeadlineMarginSeconds)
    ) {
      return this.abandonSettlement(
        row,
        "The NEAR Intents deposit address for the payout is about to expire",
        balance,
      );
    }

    if (row.status !== TransferStatus.Processing) {
      const moved = await this.transitionTransferStatus(
        row.id,
        row.status,
        TransferStatus.Processing,
        "Transfer settlement submitted",
      );

      if (!moved) {
        return;
      }

      row = {
        ...row,
        status: TransferStatus.Processing,
      };
    }

    const data = kite.factory.settle(ctx.struct);
    const simulation = await kite.simulateFactoryCall(
      ctx.client,
      ctx.factoryAddress,
      ctx.onchainActor.getAddress(),
      data,
    );

    if (!simulation.ok) {
      if (simulation.kind === "transient")
        throw new AppError(simulation.message);

      if (simulation.errorName === "InvoiceNotOpen")
        return this.reconcileClosedTransfer(
          { row },
          await kite.readStatus(ctx.client, row.payinAddress),
        );

      if (simulation.errorName === "InsufficientPayment")
        throw new AppError("Deposit not visible to the contract yet");

      return this.abandonSettlement(
        row,
        simulation.errorName ?? simulation.message,
        balance,
      );
    }

    const receipt = await this.sendFactoryCall(ctx, data);

    await this.triggerCallbackFromReceipt(
      ctx.caip2Id,
      row.payinAddress,
      receipt,
    );
  };

  private closedReason = (row: {
    status: TransferStatus;
    x402SettledAt: Date | null;
  }) => {
    if (row.status === TransferStatus.Settled) {
      return "The transfer has settled";
    }

    if (row.status === TransferStatus.Refunded) {
      return "The transfer has already been refunded";
    }

    if (row.status === TransferStatus.Failed && row.x402SettledAt) {
      return "The x402 payment was accepted, so its funds are held for manual resolution";
    }

    return null;
  };

  refundTransfer = async (
    transferId: string,
    useGasSponsor = true,
  ): Promise<{ refunded: true } | { refunded: false; reason: string }> => {
    if (await this.isNearTransfer(transferId)) {
      return this.refundNearTransfer(transferId);
    }

    const ctx = await this.getOnchainTransfer(transferId);
    const row = ctx.row;

    const closed = this.closedReason(row);
    if (closed) return { refunded: false, reason: closed };

    const balance = await ctx.onchainActor.getBalance(
      ctx.caip2Id,
      ctx.struct.payInTokenAddress,
      row.payinAddress,
    );

    if (balance === 0n) {
      return {
        refunded: false,
        reason: `There is nothing to refund: the pay-in address holds no ${row.quote.sourceToken.symbol}`,
      };
    }

    const data = kite.factory.refund(ctx.struct);
    const simulation = await kite.simulateFactoryCall(
      ctx.client,
      ctx.factoryAddress,
      ctx.onchainActor.getAddress(),
      data,
    );

    if (!simulation.ok) {
      if (simulation.kind === "transient")
        throw new AppError(simulation.message);

      if (simulation.errorName === "InvoiceNotOpen") {
        await this.reconcileClosedTransfer(
          ctx,
          await kite.readStatus(ctx.client, ctx.row.payinAddress),
        );
        return {
          refunded: false,
          reason: "The transfer has already closed on-chain",
        };
      }

      throw new AppError(simulation.errorName ?? simulation.message);
    }

    const receipt = await this.sendFactoryCall(ctx, data, useGasSponsor);

    await this.triggerCallbackFromReceipt(
      ctx.caip2Id,
      ctx.row.payinAddress,
      receipt,
    );

    return { refunded: true };
  };

  recoverTransferToken = async (transferId: string, tokenAddress: string) => {
    const row = await this.loadTransfer(transferId);
    if (!row || (row.status === TransferStatus.Failed && row.x402SettledAt)) {
      return;
    }

    const result = await this.recoverToken(
      transferId,
      tokenAddress,
      zeroAddress,
    );

    if (result.status !== "failed") return;

    const { failure } = result;
    if (failure.kind === "transient") throw new AppError(failure.message);

    // RecoveryNotAllowed: the transfer is still open; it's retried once it closes.
    if (failure.errorName !== "RecoveryNotAllowed") {
      console.warn(
        `Recovering ${tokenAddress} from transfer ${transferId} needs attention: ${failure.errorName ?? failure.message}`,
      );
    }
  };

  recover = async (
    transferId: string,
    tokenAddress: string,
    destinationAddress: string,
    useGasSponsor = true,
  ) => {
    const row = await this.loadTransfer(transferId);
    if (!row) throw new NotFoundError("transfer", transferId);

    if (row.status === TransferStatus.Failed && row.x402SettledAt) {
      throw new PreconditionError(this.closedReason(row)!);
    }

    const token = [row.quote.sourceToken, row.quote.targetToken].find((item) =>
      common.isSameAddress(item.address, tokenAddress),
    );
    const open =
      row.status !== TransferStatus.Settled &&
      row.status !== TransferStatus.Refunded;

    // The contract only releases these through settlement or a refund.
    if (open && token) {
      throw new PreconditionError(
        `${token.symbol} is the transfer's own token; while the transfer is open it leaves by settling or refunding`,
      );
    }

    const result = await this.recoverToken(
      transferId,
      common.normalizeAddress(tokenAddress),
      common.normalizeAddress(destinationAddress),
      useGasSponsor,
    );

    if (result.status === "empty") {
      throw new PreconditionError(
        "There is nothing to recover: the pay-in address holds none of that token",
      );
    }

    if (result.status === "failed") {
      const { failure } = result;
      throw new AppError(
        failure.kind === "revert"
          ? (failure.errorName ?? failure.message)
          : failure.message,
      );
    }
  };

  getRecoveryBalance = async (transferId: string, tokenAddress: string) => {
    if (await this.isNearTransfer(transferId)) {
      return this.nearBalance(
        await this.getNearTransfer(transferId),
        common.normalizeAddress(tokenAddress),
      );
    }

    const ctx = await this.getOnchainTransfer(transferId);
    return ctx.onchainActor.getBalance(
      ctx.caip2Id,
      common.normalizeAddress(tokenAddress),
      ctx.row.payinAddress,
    );
  };

  sweep = async () => {
    const staleBefore = new Date(Date.now() - common.toMs(2 * OneMinute));
    const rows = await db.query.transfer.findMany({
      where: inArray(transfer.status, [...SettleableTransferStatuses]),
      orderBy: asc(transfer.updatedAt),
      columns: {
        id: true,
        status: true,
        updatedAt: true,
      },
      with: {
        quote: {
          columns: {
            expiresAt: true,
          },
        },
      },
      limit: 500,
    });

    for (const row of rows) {
      const expired = row.quote.expiresAt.getTime() <= Date.now();

      if (
        expired ||
        row.status === TransferStatus.AwaitingDeposit ||
        row.updatedAt < staleBefore
      ) {
        await Scheduler.enqueueSettle(row.id);
      }
    }

    await new OperatorForwardService().requeueStuck();
    await new PayoutService().requeueUnfinished();
  };

  handleOnchainNotifierCallback = async (
    result: OnchainNotifierCallbackResult,
  ) => {
    const errors: unknown[] = [];

    const handleOnchainItem = async (
      item: OnchainNotifierCallbackResultItem,
    ) => {
      const chain = await new ChainService().getChainByCaip2Id(item.caip2Id);
      if (!chain) {
        return;
      }

      const transfer_ = await db.query.transfer.findFirst({
        where: eq(
          transfer.payinAddress,
          common.normalizeAddress(item.payinAddress),
        ),
        with: {
          quote: {
            with: {
              sourceToken: true,
            },
          },
        },
      });

      if (!transfer_ || transfer_.quote.chainId !== chain.id) {
        return;
      }

      const sourceId = this.callbackSourceId(item);

      switch (item.type) {
        case "DepositReceived": {
          const token = await new TokenService().findTokenByAddress(
            chain.id,
            item.tokenAddress,
          );

          if (!token) {
            return;
          }

          const address = common.normalizeAddress(item.payinAddress);

          await this.createDeposit(
            {
              address,
              senderAddress: common.normalizeAddress(item.from),
              amount: item.amount,
              blockchainHash: item.blockchainHash,
              logIndex: item.logIndex,
              chainId: chain.id,
              tokenId: token.id,
            },
            transfer_.appId,
            transfer_.id,
            sourceId,
          );

          const isPayInToken = transfer_.quote.sourceToken.id === token.id;

          if (
            isPayInToken &&
            transfer_.x402Payer &&
            common.isSameAddress(item.from, transfer_.x402Payer) &&
            item.amount === transfer_.quote.sourceAmount
          ) {
            await db
              .update(transfer)
              .set({ x402BlockchainHash: item.blockchainHash })
              .where(
                and(
                  eq(transfer.id, transfer_.id),
                  eq(transfer.x402Payer, transfer_.x402Payer),
                  isNull(transfer.x402BlockchainHash),
                ),
              );
          }

          switch (transfer_.status) {
            case TransferStatus.Settled:
            case TransferStatus.Refunded:
              await Scheduler.enqueueRecover(transfer_.id, token.address);
              return;

            case TransferStatus.Cancelled:
              await Scheduler.enqueueRefund(transfer_.id);
              return;

            case TransferStatus.Failed:
              return;
          }

          if (!isPayInToken) {
            await Scheduler.enqueueRecover(transfer_.id, token.address);
            return;
          }

          if (
            ![
              TransferStatus.AwaitingDeposit,
              TransferStatus.x402Settled,
              TransferStatus.DepositReceived,
            ].includes(transfer_.status)
          ) {
            return;
          }

          const received = await db.query.deposit.findMany({
            columns: { amount: true },
            where: and(
              eq(deposit.address, transfer_.payinAddress),
              eq(deposit.tokenId, token.id),
            ),
          });

          const totalReceived = received.reduce(
            (total, row) => total + row.amount,
            0n,
          );

          if (totalReceived < transfer_.quote.sourceAmount) {
            return;
          }

          if (transfer_.status !== TransferStatus.DepositReceived) {
            await this.transitionTransferStatus(
              transfer_.id,
              transfer_.status,
              TransferStatus.DepositReceived,
              "Expected deposit received",
            );
          }

          await Scheduler.enqueueSettle(transfer_.id);

          return;
        }

        case "FeePaid": {
          const quoteFeeId = common.bytes32ToUuid(item.feeId);
          if (quoteFeeId) {
            await new QuoteService().addQuoteFeeReceipt(
              quoteFeeId,
              item.blockchainHash,
            );
          }

          return;
        }

        case "ExcessRefunded":
        case "Recovered": {
          await db.transaction(async (tx) => {
            const [createdEvent] = await tx
              .insert(event)
              .values({
                appId: transfer_.appId,
                category:
                  item.type === "ExcessRefunded"
                    ? WebhookCategory.ExcessRefund
                    : WebhookCategory.Recovery,
                currentCategoryStatus: "Completed",
                sourceId,
                data: common.serializeData({
                  transferId: transfer_.id,
                  caip2Id: item.caip2Id,
                  tokenAddress: item.tokenAddress,
                  amount: item.amount,
                  to: item.to,
                  blockchainHash: item.blockchainHash,
                }),
              })
              .onConflictDoNothing()
              .returning({ id: event.id });

            if (!createdEvent) {
              return;
            }

            await Scheduler.enqueueEvent(
              transfer_.appId,
              createdEvent.id,
              dbWithTransaction(tx),
            );

            await new OperatorForwardService().recordForward(tx, {
              transfer: transfer_,
              item,
              sourceId,
            });
          });

          return;
        }

        case "Refunded": {
          const symbol = transfer_.quote.sourceToken.symbol;
          const amount = formatUnits(
            item.amountRefunded,
            transfer_.quote.sourceToken.decimals,
          );

          const chainType = getChain(item.caip2Id).type;
          const sourceToken = transfer_.quote.sourceToken.address;
          const onchainActor = getOnchainActor(chainType);
          let balance = await onchainActor.getBalance(
            item.caip2Id,
            sourceToken,
            transfer_.payinAddress,
          );
          if (sourceToken === NearNativeToken) {
            balance =
              balance > NearDepositReserve ? balance - NearDepositReserve : 0n;
          }

          const undelivered = item.amountRefunded === 0n && balance > 0n;
          const description = undelivered
            ? `Refund to ${item.refundAddress} could not be delivered`
            : `Refunded ${amount} ${symbol} to ${item.refundAddress}`;

          await db.transaction(async (tx) => {
            await this.transitionTransferStatus(
              transfer_.id,
              transfer_.status,
              TransferStatus.Refunded,
              description,
              { refundBlockchainHash: item.blockchainHash },
              tx,
            );

            await new OperatorForwardService().recordForward(tx, {
              transfer: transfer_,
              item,
              sourceId,
            });
          });

          await db
            .update(transfer)
            .set({ refundBlockchainHash: item.blockchainHash })
            .where(
              and(
                eq(transfer.id, transfer_.id),
                eq(transfer.status, TransferStatus.Refunded),
                isNull(transfer.refundBlockchainHash),
              ),
            );

          await this.enqueueLeftoverRecovery(transfer_.id);
          return;
        }

        case "Settled": {
          await this.transitionTransferStatus(
            transfer_.id,
            transfer_.status,
            TransferStatus.Settled,
            "Transfer settled",
            { settlementBlockchainHash: item.blockchainHash },
          );

          await db
            .update(transfer)
            .set({ settlementBlockchainHash: item.blockchainHash })
            .where(
              and(
                eq(transfer.id, transfer_.id),
                eq(transfer.status, TransferStatus.Settled),
                isNull(transfer.settlementBlockchainHash),
              ),
            );

          await this.enqueueLeftoverRecovery(transfer_.id);
          return;
        }
      }
    };

    for (const item of result) {
      await handleOnchainItem(item).catch((e) => errors.push(e));
    }

    if (errors.length === 1) throw errors[0];
    if (errors.length > 1) throw new AggregateError(errors);
  };

  getTransfer = async (appId: string, transferId: string) => {
    return await db.query.transfer.findFirst({
      where: and(eq(transfer.appId, appId), eq(transfer.id, transferId)),
      columns: { trackedBy: false },
      with: {
        timeline: true,
        payout: { columns: { quote: false } },
        quote: {
          with: {
            sourceToken: true,
            targetToken: true,
            chain: true,
            fees: true,
            customer: true,
            paymentLink: true,
          },
        },
      },
    });
  };

  getTransferByPayinAddress = async (appId: string, payinAddress: string) => {
    return await db.query.transfer.findFirst({
      where: and(
        eq(transfer.appId, appId),
        eq(transfer.payinAddress, common.normalizeAddress(payinAddress)),
      ),
      columns: { trackedBy: false },
      with: {
        timeline: true,
        payout: {
          columns: {
            quote: false,
          },
        },
        quote: {
          with: {
            sourceToken: true,
            targetToken: true,
            chain: true,
            fees: true,
            customer: true,
            paymentLink: true,
          },
        },
      },
    });
  };

  getTransfers = async (
    input: WithPageInput<{
      appId?: string;
      status?: TransferStatus;
      q?: string;
    }>,
  ) => {
    const pattern = input.q ? searchPattern(input.q) : undefined;
    const where = and(
      input.appId ? eq(transfer.appId, input.appId) : undefined,
      input.status ? eq(transfer.status, input.status) : undefined,
      pattern
        ? or(
            sql`${transfer.id}::text ilike ${pattern}`,
            ilike(transfer.payinAddress, pattern),
            inArray(
              transfer.quoteId,
              db
                .select({ id: quote.id })
                .from(quote)
                .leftJoin(
                  customer,
                  and(
                    eq(customer.id, quote.customerId),
                    eq(customer.appId, quote.appId),
                  ),
                )
                .where(
                  or(
                    ilike(quote.reference, pattern),
                    ilike(customer.name, pattern),
                    ilike(customer.externalId, pattern),
                  ),
                ),
            ),
          )
        : undefined,
    );

    return paginate(
      input,
      (limit, offset) => {
        return db.query.transfer.findMany({
          where,
          orderBy: desc(transfer.createdAt),
          limit,
          offset,
          columns: { trackedBy: false },
          with: {
            payout: {
              columns: {
                quote: false,
              },
            },
            app: {
              columns: {
                id: true,
                icon: true,
                name: true,
              },
            },
            timeline: true,
            quote: {
              with: {
                sourceToken: true,
                targetToken: true,
                chain: true,
                fees: true,
                customer: true,
                paymentLink: true,
              },
            },
          },
        });
      },
      async () => {
        const [row] = await db
          .select({ value: count() })
          .from(transfer)
          .where(where);

        return row.value;
      },
    );
  };
}
