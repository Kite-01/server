import { createHash } from "node:crypto";
import { KiteMaxFees } from "./constants";
import { AppError } from "./errors";
import { common } from "./common";
import { gnoSubRealmAddress, isGnoAddress, isGnoToken } from "./gnoAddress";

export type GnoKiteTransfer = {
  id: string;
  token: string;
  amount: string;
  recipient: string;
  fees: Array<{ recipient: string; amount: string }>;
  refund: string;
  expires_at: string;
};

export type GnoKiteStatus = "Open" | "Settled" | "Refunded";

export const GnoKiteErrors = [
  "NotOperator",
  "NotAdmin",
  "InvalidTransfer",
  "NotOpen",
  "Expired",
  "InsufficientPayment",
  "NotExpired",
  "NothingToRefund",
  "RecoveryNotAllowed",
  "NothingToRecover",
] as const;

const Int = /^(0|[1-9][0-9]*)$/;

class KiteGnoContract {
  // byte for byte with Transfer.Encode in Kite-01/gno-contracts' p/kite
  encode = (t: GnoKiteTransfer) =>
    [
      "kite1",
      `id=${t.id}`,
      `token=${t.token}`,
      `amount=${t.amount}`,
      `recipient=${t.recipient}`,
      `fees=${t.fees.map((fee) => `${fee.recipient}:${fee.amount}`).join(",")}`,
      `refund=${t.refund}`,
      `expires=${t.expires_at}`,
    ].join(";");

  hash = (t: GnoKiteTransfer) =>
    createHash("sha256").update(this.encode(t)).digest("hex");

  subpath = (t: GnoKiteTransfer) => `t/${this.hash(t)}`;

  predictAddress = (realm: string, t: GnoKiteTransfer) => {
    const error = this.validateTransferInput(t);
    if (error) throw new AppError(error);
    return gnoSubRealmAddress(realm, this.subpath(t));
  };

  buildTransferInput = (input: {
    transferId: string;
    token: string;
    amount: bigint;
    recipient: string;
    fees: Array<{ id: string; recipient: string; amount: bigint }>;
    refundAddress: string;
    expiresAt: Date;
  }): GnoKiteTransfer => ({
    id: input.transferId.replaceAll("-", ""),
    token: input.token,
    amount: input.amount.toString(),
    recipient: input.recipient,
    fees: this.sortFees(input.fees).map((fee) => ({
      recipient: fee.recipient,
      amount: fee.amount.toString(),
    })),
    refund: input.refundAddress,
    expires_at: Math.floor(input.expiresAt.getTime() / 1000).toString(),
  });

  sortFees = <T extends { id: string }>(fees: T[]) =>
    [...fees].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  validateTransferInput = (t: GnoKiteTransfer) => {
    if (!/^[0-9a-f]{32}$/.test(t.id) || /^0+$/.test(t.id)) {
      return "The transfer id is invalid";
    }

    if (!isGnoToken(t.token)) return `${t.token} is not a Gno token`;

    for (const address of [
      t.recipient,
      t.refund,
      ...t.fees.map((f) => f.recipient),
    ]) {
      if (!isGnoAddress(address))
        return `${address} is not a valid Gno address`;
    }

    const amounts = [t.amount, t.expires_at, ...t.fees.map((f) => f.amount)];
    if (
      !amounts.every((value) => Int.test(value) && BigInt(value) < 2n ** 63n)
    ) {
      return "Amounts must be integers that fit in an int64";
    }

    if (BigInt(t.amount) <= 0n) return "The amount must be greater than zero";

    if (t.fees.length > KiteMaxFees) {
      return `At most ${KiteMaxFees} fees can apply to a transfer (${t.fees.length} matched)`;
    }

    if (t.fees.some((fee) => BigInt(fee.amount) <= 0n)) {
      return "Every fee must be greater than zero";
    }

    const totalFees = t.fees.reduce((total, f) => total + BigInt(f.amount), 0n);
    if (BigInt(t.amount) < totalFees) {
      return "Fees amount exceed the settlement amount";
    }

    return null;
  };

  parseEvents = (input: {
    caip2Id: Caip2Id;
    realm: string;
    transactionHash: string;
    token: string;
    feeIds: string[];
    events: Array<{
      type: string;
      pkg_path: string;
      attrs: Array<{ key: string; value: string }> | null;
    }>;
  }) => {
    const items: OnchainNotifierCallbackResult = [];

    input.events.forEach((event, index) => {
      if (event.pkg_path !== input.realm) return;
      const data = Object.fromEntries(
        (event.attrs ?? []).map((attr) => [attr.key, attr.value]),
      );
      if (!/^[0-9a-f]{32}$/.test(data.transfer_id ?? "")) return;

      const base = {
        caip2Id: input.caip2Id,
        blockchainHash: input.transactionHash,
        logIndex: String(index),
        payinAddress: data.deposit,
        transferId: common.uuidToBytes32(data.transfer_id),
      };

      switch (event.type) {
        case "Settled":
          items.push({ ...base, type: "Settled" });
          break;

        case "FeePaid": {
          const feeId = input.feeIds[Number(data.index)];
          if (feeId) {
            items.push({
              ...base,
              type: "FeePaid",
              feeId: common.uuidToBytes32(feeId),
            });
          }
          break;
        }

        case "Refunded":
          items.push({
            ...base,
            type: "Refunded",
            refundAddress: data.to,
            amountRefunded: BigInt(data.amount),
          });
          break;

        case "ExcessRefunded":
        case "Recovered":
          items.push({
            ...base,
            type: event.type,
            tokenAddress: data.token ?? input.token,
            amount: BigInt(data.amount),
            to: data.to,
          });
          break;
      }
    });

    return items;
  };

  errorName = (message: string) => {
    const name = /kite: (\w+)/.exec(message)?.[1];
    return GnoKiteErrors.find((item) => item === name) ?? null;
  };
}

export const kiteGno = new KiteGnoContract();
