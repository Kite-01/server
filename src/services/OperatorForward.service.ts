import {
  ChainType,
  OneMinute,
  OperatorForwardKind,
  OperatorForwardStatus,
} from "../shared/constants";
import {
  AppError,
  NotFoundError,
  OperatorTransactionFailedError,
} from "../shared/errors";
import { encodeFunctionData, erc20Abi, type Address } from "viem";
import { db, dbWithTransaction, type Transaction } from "../db";
import { deposit, operatorForward, token } from "../db/schema";
import { and, eq, inArray, lt } from "drizzle-orm";
import { getOnchainActor } from "../shared/onchainActor";
import { Scheduler } from "../shared/scheduler";
import { KvService } from "./Kv.service";
import { getChain } from "../shared/chains";
import { common } from "../shared/common";

export class OperatorForwardService {
  private markSent = async (forwardId: string, blockchainHash: string) => {
    await db
      .update(operatorForward)
      .set({ status: OperatorForwardStatus.Sent, blockchainHash, error: null })
      .where(eq(operatorForward.id, forwardId));
  };

  private markFailed = async (forwardId: string, error: string) => {
    await db
      .update(operatorForward)
      .set({ status: OperatorForwardStatus.Failed, error })
      .where(eq(operatorForward.id, forwardId));
  };

  private decideOperatorForward = (input: {
    kind: OperatorForwardKind;
    x402Accepted: boolean;
    x402Payer: string | null;
    isPayInToken: boolean;
    amountIn: bigint;
    deposits: Array<{
      sender: string;
      amount: bigint;
    }>;
  }) => {
    const held = (reason: string) => ({
      recipient: null,
      status: OperatorForwardStatus.Held,
      reason,
    });

    if (input.kind === OperatorForwardKind.Refund && input.x402Accepted) {
      return held(
        "The x402 payment was accepted, so the refund is held for manual resolution",
      );
    }

    if (input.kind === OperatorForwardKind.Recovery && input.isPayInToken) {
      return held(
        "Recovered payin tokens can't be sent to a sender automatically",
      );
    }

    const bySender = new Map<string, bigint>();
    for (const deposit of input.deposits) {
      const key = deposit.sender.toLowerCase();
      bySender.set(key, (bySender.get(key) ?? 0n) + deposit.amount);
    }

    if (
      input.kind === OperatorForwardKind.Excess &&
      input.isPayInToken &&
      input.x402Payer
    ) {
      const key = input.x402Payer.toLowerCase();
      const remaining = (bySender.get(key) ?? 0n) - input.amountIn;

      if (remaining > 0n) bySender.set(key, remaining);
      else bySender.delete(key);
    }

    const senders = [...bySender.entries()].filter(([, amount]) => amount > 0n);

    if (senders.length === 1) {
      return {
        recipient: common.normalizeAddress(senders[0][0]),
        status: OperatorForwardStatus.Pending,
        reason: null,
      };
    }

    if (
      senders.length === 0 &&
      input.kind === OperatorForwardKind.Refund &&
      input.x402Payer
    ) {
      return {
        recipient: common.normalizeAddress(input.x402Payer),
        status: OperatorForwardStatus.Pending,
        reason: null,
      };
    }

    return held(
      senders.length === 0
        ? "No deposit is on record for these funds"
        : "The funds came from more than one sender",
    );
  };

  recordForward = async (
    transaction: Transaction,
    input: {
      sourceId: string;
      item: OnchainNotifierCallbackResultItem;
      transfer: {
        id: string;
        payinAddress: string;
        refundAddress: string;
        x402Payer: string | null;
        x402SettledAt: Date | null;
        quote: {
          chainId: string;
          sourceAmount: bigint;
          sourceToken: {
            address: string;
          };
        };
      };
    },
  ) => {
    const { transfer, item, sourceId } = input;

    const operator = getOnchainActor(ChainType.Evm).getAddress();
    if (!common.isSameAddress(transfer.refundAddress, operator)) {
      return;
    }

    const source = (() => {
      switch (item.type) {
        case "Refunded":
          return {
            kind: OperatorForwardKind.Refund,
            to: item.refundAddress,
            amount: item.amountRefunded,
            tokenAddress: transfer.quote.sourceToken.address,
          };

        case "ExcessRefunded":
          return {
            kind: OperatorForwardKind.Excess,
            to: item.to,
            amount: item.amount,
            tokenAddress: item.tokenAddress,
          };

        case "Recovered":
          return {
            kind: OperatorForwardKind.Recovery,
            to: item.to,
            amount: item.amount,
            tokenAddress: item.tokenAddress,
          };

        default:
          throw new AppError(`"${item.type}" cannot trigger a forward`);
      }
    })();

    if (!common.isSameAddress(source.to, operator) || source.amount === 0n) {
      return;
    }

    const tokenRow = await transaction.query.token.findFirst({
      where: and(
        eq(token.chainId, transfer.quote.chainId),
        eq(token.address, common.normalizeAddress(source.tokenAddress)),
      ),
      with: {
        deposits: {
          where: eq(
            deposit.address,
            common.normalizeAddress(transfer.payinAddress),
          ),
        },
      },
    });

    if (!tokenRow) {
      throw new NotFoundError(
        "token",
        `${transfer.quote.chainId}:${source.tokenAddress}`,
      );
    }

    const deposits = tokenRow?.deposits ?? [];
    const decision = this.decideOperatorForward({
      kind: source.kind,
      x402Accepted: !!transfer.x402SettledAt,
      x402Payer: transfer.x402Payer,
      isPayInToken: common.isSameAddress(
        source.tokenAddress,
        transfer.quote.sourceToken.address,
      ),
      amountIn: transfer.quote.sourceAmount,
      deposits: deposits.map((d) => ({
        sender: d.senderAddress,
        amount: d.amount,
      })),
    });

    const [row] = await transaction
      .insert(operatorForward)
      .values({
        transferId: transfer.id,
        sourceId,
        sourceBlockchainHash: item.blockchainHash,
        kind: source.kind,
        tokenId: tokenRow.id,
        amount: source.amount,
        recipient: decision.recipient,
        status: decision.status,
        reason: decision.reason,
      })
      .onConflictDoNothing()
      .returning({ id: operatorForward.id, status: operatorForward.status });

    if (row?.status === OperatorForwardStatus.Pending) {
      await Scheduler.enqueueForward(row.id, dbWithTransaction(transaction));
    }
  };

  processForward = async (forwardId: string) => {
    const row = await db.query.operatorForward.findFirst({
      where: eq(operatorForward.id, forwardId),
      with: {
        token: true,
        transfer: {
          with: {
            quote: {
              with: {
                chain: true,
              },
            },
          },
        },
      },
    });

    if (
      !row?.recipient ||
      ![
        OperatorForwardStatus.Pending,
        OperatorForwardStatus.Submitted,
      ].includes(row.status)
    ) {
      return;
    }

    const caip2Id = row.transfer.quote.chain.caip2Id;
    const chain = getChain(caip2Id);
    const onchainActor = getOnchainActor(chain.type);
    const options: SdkOptions = {
      variables: await new KvService().getSdkOptionVariables(),
    };

    const confirmations = await onchainActor.getConfirmations(
      caip2Id,
      row.sourceBlockchainHash,
    );

    if (confirmations < BigInt(chain.confirmations)) {
      throw new AppError(
        `Waiting for confirmation: ${confirmations}/${chain.confirmations}`,
      );
    }

    if (row.status === OperatorForwardStatus.Submitted) {
      if (!row.callId) {
        return this.markFailed(
          row.id,
          "Payout may have been submitted before a restart; check operator wallet before retrying",
        );
      }

      const status = await onchainActor.getTransactionStatus(
        caip2Id,
        row.callId,
        options,
      );

      if (status.status === "success")
        return this.markSent(row.id, status.transactionHash);

      if (status.status === "pending")
        throw new AppError("Payout is still pending");

      // failed onchain, nothing went out
      // submitting again is safe.
    }

    const [claimed] = await db
      .update(operatorForward)
      .set({ status: OperatorForwardStatus.Submitted, callId: null })
      .where(
        and(
          eq(operatorForward.id, row.id),
          eq(operatorForward.status, row.status),
        ),
      )
      .returning({ id: operatorForward.id });

    if (!claimed) {
      return;
    }

    const tokenAddress = row.token.address;
    const isNative = common.isZeroAddress(tokenAddress);

    try {
      const transactionHash = await onchainActor.sendTransaction(
        {
          caip2Id,
          to: isNative ? row.recipient : tokenAddress,
          value: isNative ? row.amount : 0n,
          data: isNative
            ? undefined
            : encodeFunctionData({
                abi: erc20Abi,
                functionName: "transfer",
                args: [row.recipient as Address, row.amount],
              }),
        },
        options,
        {
          onSubmitted: async (callId) => {
            await db
              .update(operatorForward)
              .set({ callId })
              .where(eq(operatorForward.id, row.id));
          },
        },
      );

      await this.markSent(row.id, transactionHash);
    } catch (e) {
      if (e instanceof OperatorTransactionFailedError) {
        await this.markFailed(row.id, e.message);
        return;
      }

      throw e;
    }
  };

  requeueStuck = async () => {
    const items = await db.query.operatorForward.findMany({
      columns: {
        id: true,
      },
      where: and(
        lt(
          operatorForward.updatedAt,
          new Date(Date.now() - common.toMs(2 * OneMinute)),
        ),
        inArray(operatorForward.status, [
          OperatorForwardStatus.Pending,
          OperatorForwardStatus.Submitted,
        ]),
      ),
      limit: 200,
    });

    for (const item of items) {
      await Scheduler.enqueueForward(item.id);
    }
  };
}
