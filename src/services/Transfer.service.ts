import {
  encodeFunctionData,
  erc20Abi,
  formatUnits,
  hexToString,
  stringToHex,
  zeroAddress,
  type Address,
  type Hex,
} from "viem";
import {
  event,
  quote,
  transfer,
  transferTimeline,
  deposit,
} from "../db/schema";
import { AppError, NotFoundError, QuoteExpiredError } from "../shared/errors";
import { TransferStatus, WebhookCategory } from "../shared/constants";
import { and, count, desc, eq, isNull } from "drizzle-orm";
import { KiteFactory__factory } from "@kite-01/contracts/typechain/factories/contracts/KiteFactory__factory";
import { type OnchainNotifier } from "../sdks/interfaces/OnchainNotifier";
import { runProviderMethod } from "../shared/providers";
import { getOnchainActor } from "../shared/onchainActor";
import { type KvService } from "./Kv.service";
import { ChainService } from "./Chain.service";
import { TokenService } from "./Token.service";
import { QuoteService } from "./Quote.service";
import { Scheduler } from "../shared/scheduler";
import { getChain } from "../shared/chains";
import { common } from "../shared/common";
import { db } from "../db";

export class TransferService {
  constructor(
    private readonly kvService: KvService,
    private readonly chainService: ChainService,
    private readonly tokenService: TokenService,
    private readonly quoteService: QuoteService,
  ) {}

  private getOnchainTransfer = async (transferId: string) => {
    const row = await db.query.transfer.findFirst({
      where: eq(transfer.id, transferId),
      with: {
        quote: {
          with: {
            sourceToken: true,
            targetToken: true,
            fees: true,
            chain: {
              with: {
                config: true,
              },
            },
          },
        },
      },
    });

    if (!row) throw new NotFoundError("transfer", transferId);
    if (!row.quote.chain.config)
      throw new AppError("Selected chain is not configured");

    const chain = getChain(row.quote.chain.caip2Id);

    return {
      row,
      caip2Id: row.quote.chain.caip2Id,
      factoryAddress: row.quote.chain.config.kiteFactoryAddress,
      transferInput: {
        id: stringToHex(row.id),
        payInTokenAddress: row.quote.sourceToken.address as Address,
        amountIn: row.quote.sourceAmount,
        settlementTokenAddress: row.quote.targetToken.address as Address,
        settlementRecipient: row.settlementRecipient,
        minAmountOut: row.minAmountOut,
        refundAddress: row.refundAddress,
        expiresAt: BigInt(Math.floor(row.quote.expiresAt.getTime() / 1000)),
        routerAddress: (row.quote.sourceToken.id === row.quote.targetToken.id
          ? zeroAddress
          : chain.contracts.Uniswap.SwapRouter02) as Address,
        poolFeeTier: row.quote.uniswapPoolFeeTier ?? 0,
        fees: row.quote.fees.map((fee) => ({
          id: stringToHex(fee.id),
          recipient: fee.feeAddress,
          amount: fee.amount,
        })),
      },
    };
  };

  private sendFactoryCall = async (
    caip2Id: Caip2Id,
    factoryAddress: string,
    data: string,
  ) => {
    const onchainActor = getOnchainActor(getChain(caip2Id).type);
    const options: SdkOptions = {
      variables: await this.kvService.getSdkOptionVariables(),
    };

    const transactionHash = await onchainActor.sendTransaction(
      { caip2Id, to: factoryAddress, data, value: 0n },
      options,
    );

    const receipt = await onchainActor.waitForReceipt(caip2Id, transactionHash);
    if (receipt.status !== "success") {
      throw new AppError(`Transaction reverted: ${transactionHash}`);
    }

    return transactionHash;
  };

  private callbackSourceId = (item: OnchainNotifierCallbackResultItem) => {
    return `${item.caip2Id}/${item.blockchainHash.toLowerCase()}/${item.logIndex}/${item.type}`;
  };

  private doOperatorRefund = async (
    caip2Id: Caip2Id,
    tokenAddress: string,
    to: string,
    amount: bigint,
  ) => {
    let transactionHash;

    const onchainActor = getOnchainActor(getChain(caip2Id).type);
    const options: SdkOptions = {
      variables: await this.kvService.getSdkOptionVariables(),
    };

    if (common.isZeroAddress(tokenAddress)) {
      transactionHash = await onchainActor.sendTransaction(
        { caip2Id, to, value: amount },
        options,
      );
    } else {
      const data = encodeFunctionData({
        abi: erc20Abi,
        functionName: "transfer",
        args: [to as Address, amount],
      });

      transactionHash = await onchainActor.sendTransaction(
        { caip2Id, to: tokenAddress, data, value: 0n },
        options,
      );
    }

    const receipt = await onchainActor.waitForReceipt(caip2Id, transactionHash);
    if (receipt.status !== "success") {
      throw new AppError(
        `Operator refund transaction reverted: ${transactionHash}`,
      );
    }

    return transactionHash;
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
  ) => {
    const row = await db.query.transfer.findFirst({
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
        timeline: {
          with: {
            event: true,
          },
        },
      },
    });

    if (!row) throw new NotFoundError("transfer", transferId);
    if (row.status !== previousStatus || previousStatus === currentStatus)
      return false;

    const createdEvent = await db.transaction(async (transaction) => {
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
        .returning();

      if (!updated) return null;

      const [createdEvent] = await transaction
        .insert(event)
        .values({
          appId: row.appId,
          category: WebhookCategory.Transfer,
          previousCategoryStatus: previousStatus,
          currentCategoryStatus: currentStatus,
          data: common.serializeData({ ...row, ...updated }),
        })
        .returning();

      await transaction.insert(transferTimeline).values({
        eventId: createdEvent.id,
        transferId,
        description,
      });

      return createdEvent;
    });

    if (!createdEvent) {
      return false;
    }

    await Scheduler.enqueueEvent(row.appId, createdEvent.id);
    return true;
  };

  createDeposit = async (
    input: typeof deposit.$inferInsert,
    appId: string,
    transferId: string,
    sourceId: string,
  ) => {
    const eventId = await db.transaction(async (transaction) => {
      const [row] = await transaction
        .insert(deposit)
        .values(input)
        .onConflictDoNothing()
        .returning();

      if (!row) return null;

      const [createdEvent] = await transaction
        .insert(event)
        .values({
          appId,
          category: WebhookCategory.Deposit,
          currentCategoryStatus: "Completed",
          sourceId,
          data: common.serializeData({ ...row, transferId }),
        })
        .returning({ id: event.id });

      return createdEvent.id;
    });

    if (eventId) {
      await Scheduler.enqueueEvent(appId, eventId);
    }
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
    if (hasQuoteBeenUsed) {
      throw new AppError("Quote has been consumed, create a new one");
    }

    const quote_ = await db.query.quote.findFirst({
      where: and(eq(quote.id, quoteId), eq(quote.appId, appId)),
      with: {
        sourceToken: true,
        targetToken: true,
        fees: true,
        chain: {
          with: {
            config: {
              with: {
                settlementToken: true,
              },
            },
          },
        },
      },
    });

    if (!quote_) {
      throw new NotFoundError("quote", quoteId);
    }

    if (quote_.expiresAt.getTime() <= Date.now()) {
      throw new QuoteExpiredError(quote_.id);
    }

    if (!quote_.chain.config) {
      throw new AppError("Selected chain is not configured");
    }

    const chain = getChain(quote_.chain.caip2Id);
    const onchainActor = getOnchainActor(chain.type);

    refundAddress = common.normalizeAddress(refundAddress);
    const settlementRecipient = common.normalizeAddress(
      quote_.chain.config.settlementAddress ?? onchainActor.getAddress(),
    );

    const minAmountOut =
      (quote_.targetAmount *
        (10000n - BigInt(quote_.chain.config.slippageBps))) /
      10000n;

    const transferId = common.uuidv4();
    const isSameToken = quote_.sourceToken.id === quote_.targetToken.id;
    const client = await onchainActor.publicClient(
      quote_.chain.caip2Id,
      quote_.chain.config.rpcUrls ?? [],
    );

    const kiteFactoryInterface = KiteFactory__factory.createInterface();
    const predictAddressData = kiteFactoryInterface.encodeFunctionData(
      "predictAddress",
      [
        {
          id: stringToHex(transferId),
          payInTokenAddress: quote_.sourceToken.address as Address,
          amountIn: quote_.sourceAmount,
          settlementTokenAddress: quote_.targetToken.address as Address,
          settlementRecipient: settlementRecipient,
          minAmountOut,
          fees: quote_.fees.map((fee) => ({
            id: stringToHex(fee.id),
            recipient: fee.feeAddress,
            amount: fee.amount,
          })),
          refundAddress,
          expiresAt: BigInt(Math.floor(quote_.expiresAt.getTime() / 1000)),
          routerAddress: (isSameToken
            ? zeroAddress
            : chain.contracts.Uniswap.SwapRouter02) as Address,
          poolFeeTier: quote_.uniswapPoolFeeTier ?? 0,
        },
      ],
    );

    const predictAddressResult = await client.call({
      to: quote_.chain.config.kiteFactoryAddress as Address,
      data: predictAddressData as Hex,
    });

    if (!predictAddressResult.data)
      throw new AppError("Could not generate deposit address");

    const [payinAddress] = kiteFactoryInterface.decodeFunctionResult(
      "predictAddress",
      predictAddressResult.data,
    );

    const saved = await db.transaction(async (transaction) => {
      const [created] = await transaction
        .insert(transfer)
        .values({
          id: transferId,
          appId,
          quoteId,
          settlementRecipient,
          minAmountOut,
          refundAddress,
          payinAddress: common.normalizeAddress(payinAddress),
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
          data: { transferId: created.id, status: created.status },
        })
        .returning();

      await transaction.insert(transferTimeline).values({
        transferId: created.id,
        eventId: createdEvent.id,
        description: "Transfer created; awaiting deposit",
      });

      return { transfer: created, eventId: createdEvent.id };
    });

    await Scheduler.enqueueEvent(appId, saved.eventId);

    const options: SdkOptions = {
      variables: await this.kvService.getSdkOptionVariables(),
    };

    const providers = quote_.chain.config.onchainNotifierProviders ?? [];

    try {
      await runProviderMethod<OnchainNotifier, "trackAddressActivity">(
        providers,
        "trackAddressActivity",
        { caip2Id: quote_.chain.caip2Id, address: payinAddress },
        options,
      );

      await runProviderMethod<OnchainNotifier, "trackKiteContractEvent">(
        providers,
        "trackKiteContractEvent",
        { caip2Id: quote_.chain.caip2Id, contractAddress: payinAddress },
        options,
      );
    } catch {
      // nothing
    }

    return {
      ...saved.transfer,
      minAmountOut: minAmountOut.toString(),
      paymentInstructions: {
        caip2Id: quote_.chain.caip2Id,
        address: payinAddress,
        tokenAddress: quote_.sourceToken.address,
        amount: quote_.sourceAmount.toString(),
        expiresAt: quote_.expiresAt,
      },
    };
  };

  recover = async (
    transferId: string,
    tokenAddress: string,
    destinationAddress: string,
  ) => {
    const { caip2Id, factoryAddress, transferInput } =
      await this.getOnchainTransfer(transferId);

    const data = KiteFactory__factory.createInterface().encodeFunctionData(
      "recover",
      [
        transferInput,
        common.normalizeAddress(tokenAddress),
        common.normalizeAddress(destinationAddress),
      ],
    );

    return this.sendFactoryCall(caip2Id, factoryAddress, data);
  };

  refund = async (transferId: string) => {
    const { caip2Id, factoryAddress, transferInput } =
      await this.getOnchainTransfer(transferId);

    const data = KiteFactory__factory.createInterface().encodeFunctionData(
      "refund",
      [transferInput],
    );

    return this.sendFactoryCall(caip2Id, factoryAddress, data);
  };

  handleOnchainNotifierCallback = async (
    result: OnchainNotifierCallbackResult,
  ) => {
    for (const item of result) {
      const onchainActor = getOnchainActor(getChain(item.caip2Id).type);
      const chain = await this.chainService.getChainByCaip2Id(item.caip2Id);
      if (!chain) continue;

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

      if (!transfer_) continue;

      if (item.type === "DepositReceived") {
        const address = common.normalizeAddress(item.payinAddress);
        const token = await this.tokenService.getTokenByAddress(
          chain.id,
          item.tokenAddress,
        );

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
          this.callbackSourceId(item),
        );

        if (
          transfer_.x402Payer &&
          common.normalizeAddress(item.from) === transfer_.x402Payer &&
          transfer_.quote.sourceToken.id === token.id &&
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

        if (
          transfer_.quote.sourceToken.id === token.id &&
          [
            TransferStatus.AwaitingDeposit,
            TransferStatus.x402Settled,
            TransferStatus.DepositReceived,
          ].includes(transfer_.status)
        ) {
          const deposits = await db.query.deposit.findMany({
            columns: {
              amount: true,
            },
            where: and(
              eq(deposit.address, address),
              eq(deposit.tokenId, token.id),
            ),
          });

          const totalReceived = deposits.reduce(
            (total, row) => total + row.amount,
            0n,
          );

          if (totalReceived >= transfer_.quote.sourceAmount) {
            if (transfer_.status !== TransferStatus.DepositReceived) {
              const ok = await this.transitionTransferStatus(
                transfer_.id,
                transfer_.status,
                TransferStatus.DepositReceived,
                "Expected deposit received",
              );

              if (!ok) {
                continue;
              }
            }

            const { transferInput, caip2Id, factoryAddress } =
              await this.getOnchainTransfer(transfer_.id);

            const data =
              KiteFactory__factory.createInterface().encodeFunctionData(
                "settle",
                [transferInput],
              );

            const ok = await this.transitionTransferStatus(
              transfer_.id,
              TransferStatus.DepositReceived,
              TransferStatus.Processing,
              "Transfer settlement submitted",
            );

            if (!ok) {
              continue;
            }

            try {
              await this.sendFactoryCall(caip2Id, factoryAddress, data);
            } catch (e) {
              await this.transitionTransferStatus(
                transfer_.id,
                TransferStatus.Processing,
                TransferStatus.Failed,
                "Transfer settlement attempt failed",
              );

              await this.refund(transfer_.id);

              throw e;
            }
          }
        }

        continue;
      }

      if (item.type === "FeePaid") {
        await this.quoteService.addQuoteFeeReceipt(
          hexToString(item.feeId as Hex),
          item.blockchainHash,
        );

        continue;
      }

      if (item.type === "ExcessRefunded") {
        if (
          !!transfer_.x402Payer &&
          onchainActor.getAddress() === item.to &&
          transfer_.refundAddress === onchainActor.getAddress()
        ) {
          await this.doOperatorRefund(
            item.caip2Id,
            item.tokenAddress,
            transfer_.x402Payer,
            item.amount,
          );
        }

        const [createdEvent] = await db
          .insert(event)
          .values({
            appId: transfer_.appId,
            category: WebhookCategory.ExcessRefund,
            currentCategoryStatus: "Completed",
            sourceId: this.callbackSourceId(item),
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

        if (createdEvent)
          await Scheduler.enqueueEvent(transfer_.appId, createdEvent.id);

        continue;
      }

      if (item.type === "Recovered") {
        const [createdEvent] = await db
          .insert(event)
          .values({
            appId: transfer_.appId,
            category: WebhookCategory.Recovery,
            currentCategoryStatus: "Completed",
            sourceId: this.callbackSourceId(item),
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

        if (createdEvent)
          await Scheduler.enqueueEvent(transfer_.appId, createdEvent.id);

        continue;
      }

      if (item.type === "Refunded") {
        if (
          !!transfer_.x402Payer &&
          onchainActor.getAddress() === item.refundAddress &&
          transfer_.refundAddress === onchainActor.getAddress()
        ) {
          await this.doOperatorRefund(
            item.caip2Id,
            transfer_.quote.sourceToken.address,
            transfer_.x402Payer,
            item.amountRefunded,
          );
        }

        const symbol = transfer_.quote.sourceToken.symbol;
        const amount = formatUnits(
          item.amountRefunded,
          transfer_.quote.sourceToken.decimals,
        );

        await this.transitionTransferStatus(
          transfer_.id,
          transfer_.status,
          TransferStatus.Refunded,
          `Refunded ${Number(amount).toLocaleString()} ${symbol} to ${item.refundAddress}`,
          { refundBlockchainHash: item.blockchainHash },
        );

        continue;
      }

      if (item.type === "Settled") {
        await this.transitionTransferStatus(
          transfer_.id,
          transfer_.status,
          TransferStatus.Settled,
          "Transfer settled",
          { settlementBlockchainHash: item.blockchainHash },
        );

        continue;
      }
    }
  };

  getTransfer = async (appId: string, transferId: string) => {
    return await db.query.transfer.findFirst({
      where: and(eq(transfer.appId, appId), eq(transfer.id, transferId)),
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
        timeline: { with: { event: true } },
        deposits: { with: { token: true } },
      },
    });
  };

  getTransferByPayinAddress = async (appId: string, payinAddress: string) => {
    const address = common.normalizeAddress(payinAddress);
    return await db.query.transfer.findFirst({
      where: and(eq(transfer.appId, appId), eq(transfer.payinAddress, address)),
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
        timeline: { with: { event: true } },
        deposits: { with: { token: true } },
      },
    });
  };

  getTransfers = async (appId: string) => {
    return db.query.transfer.findMany({
      where: eq(transfer.appId, appId),
      orderBy: desc(transfer.createdAt),
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
  };
}
