import {
  GnoNativeToken,
  gnoSubRealmAddress,
  isGnoAddress,
  isGnoToken,
} from "./gnoAddress";
import { KiteMaxFees } from "./constants";
import { createHash } from "node:crypto";
import { AppError } from "./errors";
import { common } from "./common";

export type GnoKiteTransfer = {
  id: string;
  token: string;
  amount: string;
  settle: string;
  min_out: string;
  route: string;
  recipient: string;
  fees: Array<{
    recipient: string;
    amount: string;
  }>;
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
  "SlippageExceeded",
] as const;

export const GnoMaxHops = 3;
const GnoSwapFees = ["100", "500", "3000", "10000"];

const Int = /^(0|[1-9][0-9]*)$/;

class KiteGnoContract {
  // byte for byte with Transfer.Encode in Kite-01/gno-contracts' p/kite
  encode = (t: GnoKiteTransfer) =>
    [
      "kite1",
      `id=${t.id}`,
      `token=${t.token}`,
      `amount=${t.amount}`,
      `settle=${t.settle}`,
      `min_out=${t.min_out}`,
      `route=${t.route}`,
      `recipient=${t.recipient}`,
      `fees=${t.fees.map((fee) => `${fee.recipient}:${fee.amount}`).join(",")}`,
      `refund=${t.refund}`,
      `expires=${t.expires_at}`,
    ].join(";");

  subpath = (t: GnoKiteTransfer) => `t/${this.hash(t)}`;

  hash = (t: GnoKiteTransfer) => {
    return createHash("sha256").update(this.encode(t)).digest("hex");
  };

  predictAddress = (realm: string, t: GnoKiteTransfer) => {
    const error = this.validateTransferInput(t);
    if (error) throw new AppError(error);
    return gnoSubRealmAddress(realm, this.subpath(t));
  };

  canSwap = (token: string, settle: string) => {
    return (
      token === settle ||
      (token !== GnoNativeToken && settle !== GnoNativeToken)
    );
  };

  buildTransferInput = (input: {
    transferId: string;
    token: string;
    amount: bigint;
    settle: string;
    minAmountOut: bigint;
    route: string | null;
    recipient: string;
    fees: Array<{
      id: string;
      recipient: string;
      amount: bigint;
    }>;
    refundAddress: string;
    expiresAt: Date;
  }): GnoKiteTransfer => ({
    id: input.transferId.replaceAll("-", ""),
    token: input.token,
    amount: input.amount.toString(),
    settle: input.settle,
    min_out: (input.token === input.settle
      ? input.amount
      : input.minAmountOut
    ).toString(),
    route: input.token === input.settle ? "" : (input.route ?? ""),
    recipient: input.recipient,
    fees: this.sortFees(input.fees).map((fee) => ({
      recipient: fee.recipient,
      amount: fee.amount.toString(),
    })),
    refund: input.refundAddress,
    expires_at: Math.floor(input.expiresAt.getTime() / 1000).toString(),
  });

  sortFees = <T extends { id: string }>(fees: T[]) => {
    return [...fees].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  };

  validateTransferInput = (t: GnoKiteTransfer) => {
    if (!/^[0-9a-f]{32}$/.test(t.id) || /^0+$/.test(t.id)) {
      return "The transfer id is invalid";
    }

    for (const token of [t.token, t.settle]) {
      if (!isGnoToken(token)) {
        return `${token} is not a Gno token`;
      }
    }

    for (const address of [
      t.recipient,
      t.refund,
      ...t.fees.map((f) => f.recipient),
    ]) {
      if (!isGnoAddress(address)) {
        return `${address} is not a valid Gno address`;
      }
    }

    const amounts = [
      t.amount,
      t.min_out,
      t.expires_at,
      ...t.fees.map((f) => f.amount),
    ];

    if (
      !amounts.every((value) => Int.test(value) && BigInt(value) < 2n ** 63n)
    ) {
      return "Amounts must be integers that fit in an int64";
    }

    if (BigInt(t.amount) <= 0n || BigInt(t.min_out) <= 0n) {
      return "The amount must be greater than zero";
    }

    if (t.token === t.settle) {
      if (t.route || t.min_out !== t.amount) {
        return "A transfer in the settlement token has no swap";
      }
    } else if (!this.canSwap(t.token, t.settle)) {
      return "GNOT can't be swapped on Gno.land: pay in GNOT only when settling in GNOT";
    } else if (!this.isRoute(t.route, t.token, t.settle)) {
      return "The swap route is invalid";
    }

    if (t.fees.length > KiteMaxFees) {
      return `At most ${KiteMaxFees} fees can apply to a transfer (${t.fees.length} matched)`;
    }

    if (t.fees.some((fee) => BigInt(fee.amount) <= 0n)) {
      return "Every fee must be greater than zero";
    }

    const totalFees = t.fees.reduce((total, f) => total + BigInt(f.amount), 0n);
    if (BigInt(t.min_out) < totalFees) {
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
      attrs: Array<{
        key: string;
        value: string;
      }> | null;
    }>;
  }) => {
    const items: OnchainNotifierCallbackResult = [];

    input.events.forEach((event, index) => {
      if (event.pkg_path !== input.realm) {
        return;
      }

      const data = Object.fromEntries(
        (event.attrs ?? []).map((attr) => [attr.key, attr.value]),
      );

      if (!/^[0-9a-f]{32}$/.test(data.transfer_id ?? "")) {
        return;
      }

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

  isRoute = (route: string, from: string, to: string) => {
    const hops = route.split("*POOL*");
    let next = from;
    for (const hop of hops) {
      const [tokenIn, tokenOut, fee, ...rest] = hop.split(":");
      if (
        rest.length ||
        tokenIn !== next ||
        !isGnoToken(tokenOut ?? "") ||
        tokenOut === GnoNativeToken ||
        !GnoSwapFees.includes(fee ?? "")
      ) {
        return false;
      }

      next = tokenOut;
    }

    return hops.length <= GnoMaxHops && next === to;
  };

  errorName = (message: string) => {
    const name = /kite: (\w+)/.exec(message)?.[1];
    return GnoKiteErrors.find((item) => item === name) ?? null;
  };
}

export const kiteGno = new KiteGnoContract();
