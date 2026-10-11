import {
  formatUnits,
  getAddress,
  isAddress,
  zeroAddress,
  type Hex,
} from "viem";
import {
  event,
  quote,
  quoteFee,
  transfer,
  transferTimeline,
  deposit,
} from "../db/schema";
import {
  AppError,
  NotFoundError,
  QuoteExpiredError,
  TransferStructMismatchError,
} from "../shared/errors";
import {
  OneMinute,
  Provider,
  SettleableTransferStatuses,
  TransferStatus,
  WebhookCategory,
} from "../shared/constants";
import { db, dbWithTransaction, type DatabaseOrTransaction } from "../db";
import { and, asc, count, desc, eq, inArray, isNull, lt } from "drizzle-orm";
import { OperatorForwardService } from "./OperatorForward.service";
import { type OnchainNotifier } from "../sdks/interfaces/OnchainNotifier";
import { runProviderMethod } from "../shared/providers";
import { getOnchainActor } from "../shared/onchainActor";
import { ChainService } from "./Chain.service";
import { TokenService } from "./Token.service";
import { QuoteService } from "./Quote.service";
import { KvService } from "./Kv.service";
import { Scheduler } from "../shared/scheduler";
import { getChain } from "../shared/chains";
import { common } from "../shared/common";
import { kite } from "../shared/kiteContract";

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
  ) => {
    const options = await this.sdkOptions();
    const transactionHash = await ctx.onchainActor.sendTransaction(
      { caip2Id: ctx.caip2Id, to: ctx.factoryAddress, data, value: 0n },
      options,
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
  ) => {
    const options = await this.sdkOptions();

    await Promise.all([
      runProviderMethod<OnchainNotifier, "trackAddressActivity">(
        providers,
        "trackAddressActivity",
        { caip2Id, address },
        options,
      ),
      runProviderMethod<OnchainNotifier, "trackKiteContractEvent">(
        providers,
        "trackKiteContractEvent",
        { caip2Id, contractAddress: address },
        options,
      ),
    ]);
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
    ctx: Awaited<ReturnType<TransferService["getOnchainTransfer"]>>,
  ) => {
    const status = await kite.readStatus(ctx.client, ctx.row.payinAddress);

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
      ].map((address) => getAddress(address)),
    );

    for (const tokenAddress of tokens) {
      await Scheduler.enqueueRecover(transferId, tokenAddress);
    }
  };

  private recoverToken = async (
    transferId: string,
    tokenAddress: string,
    destinationAddress: string,
  ) => {
    const ctx = await this.getOnchainTransfer(transferId);
    const balance = await ctx.onchainActor.getBalance(
      ctx.caip2Id,
      tokenAddress,
      ctx.row.payinAddress,
    );

    if (balance === 0n) {
      return null;
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
      return simulation;
    }

    const receipt = await this.sendFactoryCall(ctx, data);

    await this.triggerCallbackFromReceipt(
      ctx.caip2Id,
      ctx.row.payinAddress,
      receipt,
    );

    return null;
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

      return true;
    });
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
    if (quote_.expiresAt.getTime() <= Date.now())
      throw new QuoteExpiredError(quote_.id);

    const config = quote_.chain.config;
    if (!config) throw new AppError("Selected chain is not configured");
    if (!isAddress(refundAddress, { strict: false }))
      throw new AppError("The refund address is not a valid address");

    const caip2Id = quote_.chain.caip2Id;
    const chain = getChain(caip2Id);
    const onchainActor = getOnchainActor(chain.type);

    const settlementRecipient = getAddress(
      config.settlementAddress ?? onchainActor.getAddress(),
    );

    const minAmountOut =
      (quote_.targetAmount * (10000n - BigInt(config.slippageBps))) / 10000n;

    const transferId = common.uuidv4();
    const isSameToken = quote_.sourceToken.id === quote_.targetToken.id;
    const struct = kite.buildTransferInput({
      transferId,
      payInTokenAddress: quote_.sourceToken.address,
      amountIn: quote_.sourceAmount,
      settlementTokenAddress: quote_.targetToken.address,
      settlementRecipient,
      minAmountOut,
      fees: quote_.fees.map((fee) => ({
        id: fee.id,
        recipient: fee.feeAddress,
        amount: fee.amount,
      })),
      refundAddress,
      expiresAt: quote_.expiresAt,
      routerAddress: isSameToken
        ? zeroAddress
        : chain.contracts.Uniswap.SwapRouter02,
      poolFeeTier: quote_.uniswapPoolFeeTier ?? 0,
    });

    const error = kite.validateTransferInput(struct);
    if (error) throw new AppError(error);

    const client = await onchainActor.publicClient(
      caip2Id,
      config.rpcUrls ?? [],
    );

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

    await this.trackAddress(
      caip2Id,
      payinAddress,
      config.onchainNotifierProviders ?? [],
    );

    const paymentInstructions = {
      caip2Id,
      address: payinAddress,
      tokenAddress: quote_.sourceToken.address,
      amount: quote_.sourceAmount.toString(),
      expiresAt: quote_.expiresAt,
    };

    const saved = await db.transaction(async (transaction) => {
      const [created] = await transaction
        .insert(transfer)
        .values({
          id: transferId,
          appId,
          quoteId,
          settlementRecipient,
          minAmountOut,
          refundAddress: struct.refundAddress,
          payinAddress,
          kiteTransferInput: kite.serializeTransferInput(struct),
          status: TransferStatus.AwaitingDeposit,
        })
        .returning();

      const [createdEvent] = await transaction
        .insert(event)
        .values({
          appId,
          category: WebhookCategory.Transfer,
          previousCategoryStatus: TransferStatus.Created,
          currentCategoryStatus: TransferStatus.AwaitingDeposit,
          data: {
            ...created,
            quote: quote_,
            paymentInstructions,
          },
        })
        .returning({ id: event.id });

      await transaction.insert(transferTimeline).values({
        transferId: created.id,
        eventId: createdEvent.id,
        description: "Transfer created; awaiting deposit",
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
        return this.reconcileClosedTransfer({ ...ctx, row });

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

  refundTransfer = async (transferId: string) => {
    const ctx = await this.getOnchainTransfer(transferId);
    const row = ctx.row;

    if (
      row.status === TransferStatus.Settled ||
      row.status === TransferStatus.Refunded ||
      (row.status === TransferStatus.Failed && row.x402SettledAt)
    ) {
      return;
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
      if (simulation.errorName === "InvoiceNotOpen")
        return this.reconcileClosedTransfer(ctx);

      throw new AppError(simulation.errorName ?? simulation.message);
    }

    const receipt = await this.sendFactoryCall(ctx, data);

    await this.triggerCallbackFromReceipt(
      ctx.caip2Id,
      ctx.row.payinAddress,
      receipt,
    );
  };

  recoverTransferToken = async (transferId: string, tokenAddress: string) => {
    const row = await this.loadTransfer(transferId);
    if (!row || (row.status === TransferStatus.Failed && row.x402SettledAt)) {
      return;
    }

    const failure = await this.recoverToken(
      transferId,
      tokenAddress,
      zeroAddress,
    );

    if (!failure || failure.ok) return;
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
  ) => {
    const failure = await this.recoverToken(
      transferId,
      common.normalizeAddress(tokenAddress),
      common.normalizeAddress(destinationAddress),
    );

    if (failure && !failure.ok) {
      throw new AppError(
        failure.kind === "revert"
          ? (failure.errorName ?? failure.message)
          : failure.message,
      );
    }
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

    const failed = await db.query.transfer.findMany({
      columns: {
        id: true,
      },
      where: and(
        eq(transfer.status, TransferStatus.Failed),
        isNull(transfer.x402SettledAt),
        lt(transfer.updatedAt, staleBefore),
      ),
      limit: 200,
    });

    for (const row of failed) {
      await Scheduler.enqueueRefund(row.id);
    }

    await new OperatorForwardService().requeueStuck();
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
          deposits: { with: { token: true } },
          quote: { with: { sourceToken: true } },
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

          const deposits = transfer_.deposits
            .filter((deposit) => deposit.tokenId === token.id)
            .map((deposit) => deposit.amount);

          const totalReceived = deposits.reduce(
            (total, amount) => total + amount,
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

          const onchainActor = getOnchainActor(getChain(item.caip2Id).type);
          const balance = await onchainActor.getBalance(
            item.caip2Id,
            transfer_.quote.sourceToken.address,
            transfer_.payinAddress,
          );

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
      with: {
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
  };

  getTransferByPayinAddress = async (appId: string, payinAddress: string) => {
    return await db.query.transfer.findFirst({
      where: and(
        eq(transfer.appId, appId),
        eq(transfer.payinAddress, common.normalizeAddress(payinAddress)),
      ),
      with: {
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
  };

  getTransfers = async (appId: string) => {
    return db.query.transfer.findMany({
      where: eq(transfer.appId, appId),
      orderBy: desc(transfer.createdAt),
      with: {
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
  };
}
