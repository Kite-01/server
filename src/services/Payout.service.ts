import {
  ChainType,
  OneHour,
  OneMinute,
  PayoutDeadlineSeconds,
  PayoutSlippageBufferBps,
  PayoutStatus,
  TransferStatus,
} from "../shared/constants";
import {
  app,
  appChain,
  payout,
  transfer,
  transferTimeline,
} from "../db/schema";
import { and, eq, gt, inArray, notInArray } from "drizzle-orm";
import { AppError, SdkRequestError } from "../shared/errors";
import { getOnchainActor } from "../shared/onchainActor";
import { NearIntents } from "../sdks/NearIntents";
import { Scheduler } from "../shared/scheduler";
import { KvService } from "./Kv.service";
import { isAddress } from "viem";
import { getChain } from "../shared/chains";
import { common } from "../shared/common";
import { db } from "../db";

const FinalPayoutStatuses = [
  PayoutStatus.Delivered,
  PayoutStatus.Refunded,
  PayoutStatus.Failed,
];

// USDC on Ethereum and on Base, used as the source of trial quotes
const TrialOriginAssets = [
  "nep141:eth-0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48.omft.near",
  "nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near",
];

export class PayoutService {
  private sdkOptions = async (): Promise<SdkOptions> => {
    return {
      variables: await new KvService().getSdkOptionVariables(),
    };
  };

  // where a new transfer settles, and what its timeline should say about it
  planSettlement = async (input: {
    appId: string;
    chainId: string;
    caip2Id: Caip2Id;
    slippageBps: number;
    settlementToken: {
      nearIntentsAssetId: string | null;
    };
    amount: bigint;
  }): Promise<{
    recipient: string;
    description: string | null;
    payout?: Omit<typeof payout.$inferInsert, "transferId">;
  }> => {
    const [row] = await db
      .select({
        address: appChain.address,
        payoutAsset: app.payoutAsset,
        payoutAddress: app.payoutAddress,
      })
      .from(appChain)
      .innerJoin(app, eq(app.id, appChain.appId))
      .where(
        and(
          eq(appChain.appId, input.appId),
          eq(appChain.chainId, input.chainId),
        ),
      );

    const chainName = getChain(input.caip2Id).name;
    if (!row) throw new AppError(`App doesn't accept payments on ${chainName}`);

    const { address, payoutAsset, payoutAddress } = row;
    if (!payoutAsset || !payoutAddress) {
      return {
        recipient: address,
        description: null,
      };
    }

    const originAsset = input.settlementToken.nearIntentsAssetId;
    if (!originAsset) {
      return {
        recipient: address,
        description: `NEAR Intents can't pay out from ${chainName}, so it settles to ${address}`,
      };
    }

    if (originAsset === payoutAsset && isAddress(payoutAddress)) {
      return {
        recipient: payoutAddress,
        description: `Settles straight to ${payoutAddress}`,
      };
    }

    const nearIntents = new NearIntents();

    try {
      const options = await this.sdkOptions();
      const tokens = await nearIntents.getTokens(options);
      const destination = tokens.find((item) => item.assetId === payoutAsset);
      if (!destination) {
        throw new AppError("NEAR Intents no longer lists the payout token");
      }

      const deadline = new Date(
        Date.now() + common.toMs(PayoutDeadlineSeconds),
      );

      const response = await nearIntents.quote(
        {
          dry: false,
          swapType: "FLEX_INPUT",
          slippageTolerance: input.slippageBps + PayoutSlippageBufferBps,
          originAsset,
          depositType: "ORIGIN_CHAIN",
          destinationAsset: payoutAsset,
          amount: input.amount.toString(),
          refundTo: address,
          refundType: "ORIGIN_CHAIN",
          recipient: payoutAddress,
          recipientType: "DESTINATION_CHAIN",
          deadline: deadline.toISOString(),
        },
        options,
      );

      const depositAddress = response.quote.depositAddress;
      if (!depositAddress || !isAddress(depositAddress)) {
        throw new AppError("NEAR Intents returned no deposit address");
      }

      const quotedDeadline = response.quote.deadline
        ? new Date(response.quote.deadline)
        : deadline;

      return {
        recipient: depositAddress,
        description: `Paid out as ${destination.symbol} on ${destination.blockchain} to ${payoutAddress} through NEAR Intents`,
        payout: {
          depositAddress: common.normalizeAddress(depositAddress),
          destinationAsset: payoutAsset,
          destinationSymbol: destination.symbol,
          destinationChain: destination.blockchain,
          recipient: payoutAddress,
          refundTo: address,
          deadline: quotedDeadline < deadline ? quotedDeadline : deadline,
          status: PayoutStatus.Pending,
          quote: response,
        },
      };
    } catch (e) {
      return {
        recipient: address,
        description: `NEAR Intents couldn't quote a payout (${(e as Error).message}), so it settles to ${address}`,
      };
    }
  };

  validateDestination = async (payoutAsset: string, payoutAddress: string) => {
    const options = await this.sdkOptions();
    const nearIntents = new NearIntents();

    const tokens = await nearIntents.getTokens(options).catch(() => {
      throw new AppError(
        "NEAR Intents can't be reached to check the payout token; try again",
      );
    });

    if (!tokens.some((item) => item.assetId === payoutAsset)) {
      throw new AppError("NEAR Intents doesn't support this payout token");
    }

    // a trial quote that moves nothing: 1Click refuses an address it can't deliver to
    await nearIntents
      .quote(
        {
          dry: true,
          swapType: "EXACT_INPUT",
          slippageTolerance: 100,
          originAsset: TrialOriginAssets.find((id) => id !== payoutAsset)!,
          depositType: "ORIGIN_CHAIN",
          destinationAsset: payoutAsset,
          amount: "100000000",
          refundTo: getOnchainActor(ChainType.Evm).getAddress(),
          refundType: "ORIGIN_CHAIN",
          recipient: payoutAddress,
          recipientType: "DESTINATION_CHAIN",
          deadline: new Date(
            Date.now() + common.toMs(10 * OneMinute),
          ).toISOString(),
        },
        options,
      )
      .catch((e: unknown) => {
        const status = e instanceof SdkRequestError ? e.statusCode : undefined;
        throw new AppError(
          status && status < 500
            ? `NEAR Intents rejected the payout destination: ${(e as Error).message}`
            : "NEAR Intents can't be reached to check the payout destination; try again",
        );
      });
  };

  checkPayout = async (transferId: string) => {
    const row = await db.query.payout.findFirst({
      where: eq(payout.transferId, transferId),
    });

    if (!row || FinalPayoutStatuses.includes(row.status)) return;

    const nearIntents = new NearIntents();
    const result = await nearIntents.getStatus(
      row.depositAddress,
      await this.sdkOptions(),
    );

    const details = result.swapDetails ?? {};

    switch (result.status) {
      case "SUCCESS": {
        const sent = details.destinationChainTxHashes?.[0];
        return this.finish(
          row,
          {
            status: PayoutStatus.Delivered,
            amountOut: details.amountOut ? BigInt(details.amountOut) : null,
            blockchainHash: sent?.hash ?? null,
            explorerUrl: sent?.explorerUrl ?? null,
          },
          [
            "Paid out",
            details.amountOutFormatted,
            row.destinationSymbol,
            "on",
            row.destinationChain,
            "to",
            row.recipient,
          ]
            .filter(Boolean)
            .join(" "),
        );
      }

      case "REFUNDED":
        return this.finish(
          row,
          {
            status: PayoutStatus.Refunded,
            refundedAmount: details.refundedAmount
              ? BigInt(details.refundedAmount)
              : null,
            reason: details.refundReason ?? null,
          },
          `NEAR Intents refunded ${details.refundedAmountFormatted ?? "the payout"} to ${row.refundTo}${details.refundReason ? ` (${details.refundReason})` : ""}`,
        );

      case "FAILED":
        return this.finish(
          row,
          { status: PayoutStatus.Failed },
          `NEAR Intents couldn't pay out to ${row.recipient}`,
        );

      case "KNOWN_DEPOSIT_TX":
      case "INCOMPLETE_DEPOSIT":
      case "PROCESSING":
        await db
          .update(payout)
          .set({ status: PayoutStatus.Processing })
          .where(
            and(
              eq(payout.transferId, transferId),
              eq(payout.status, PayoutStatus.Pending),
            ),
          );
        return;
    }
  };

  private finish = async (
    row: typeof payout.$inferSelect,
    values: Partial<typeof payout.$inferInsert>,
    description: string,
  ) => {
    await db.transaction(async (tx) => {
      const [updated] = await tx
        .update(payout)
        .set(values)
        .where(
          and(
            eq(payout.transferId, row.transferId),
            notInArray(payout.status, FinalPayoutStatuses),
          ),
        )
        .returning({ transferId: payout.transferId });

      if (updated) {
        await tx
          .insert(transferTimeline)
          .values({ transferId: row.transferId, description });
      }
    });
  };

  requeueUnfinished = async () => {
    const rows = await db
      .select({ transferId: payout.transferId })
      .from(payout)
      .innerJoin(transfer, eq(transfer.id, payout.transferId))
      .where(
        and(
          inArray(payout.status, [
            PayoutStatus.Pending,
            PayoutStatus.Processing,
          ]),
          eq(transfer.status, TransferStatus.Settled),
          gt(payout.deadline, new Date(Date.now() - common.toMs(OneHour))),
        ),
      )
      .limit(200);

    for (const row of rows) {
      await Scheduler.enqueueCheckPayout(row.transferId);
    }
  };
}
