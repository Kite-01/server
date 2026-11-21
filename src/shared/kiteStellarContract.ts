import {
  Address,
  hash,
  nativeToScVal,
  scValToNative,
  StrKey,
  xdr,
} from "@stellar/stellar-sdk";
import { KiteMaxFees } from "./constants";
import { common } from "./common";
import { AppError } from "./errors";
import {
  isStellarAddress,
  isStellarContract,
  isStellarMuxed,
} from "./stellarAddress";

export type StellarKiteTransfer = {
  id: string;
  pay_in: string;
  amount_in: string;
  settlement_token: string;
  settlement_recipient: string;
  min_amount_out: string;
  fees: Array<{ recipient: string; amount: string }>;
  refund_address: string;
  expires_at: string;
  swap: { router: string; path: string[] } | null;
  implementation: string;
};

export type StellarKiteStatus = "Open" | "Settled" | "Refunded";

export const StellarKiteErrors: Record<number, string> = {
  1: "NotOperator",
  2: "InvalidId",
  3: "InvalidAmount",
  4: "TooManyFees",
  5: "InvalidFee",
  6: "FeesExceedMinAmountOut",
  7: "InvalidSwap",
  8: "UnknownImplementation",
  9: "NotOpen",
  10: "InsufficientPayment",
  11: "NothingToRefund",
  12: "NotExpired",
  13: "RecoveryNotAllowed",
  14: "SlippageExceeded",
  15: "NothingToRecover",
};

export const StellarSacErrors: Record<number, string> = {
  6: "AccountMissing",
  10: "InsufficientBalance",
  11: "BalanceDeauthorized",
  13: "TrustlineMissing",
};

export const StellarMaxPath = 4;

const symbol = (value: string) => xdr.ScVal.scvSymbol(value);
const i128 = (value: string | bigint) =>
  nativeToScVal(BigInt(value), { type: "i128" });
const bytes = (hex: string) => xdr.ScVal.scvBytes(Buffer.from(hex, "hex"));
const address = (value: string) => Address.fromString(value).toScVal();
const map = (entries: Record<string, xdr.ScVal>) =>
  xdr.ScVal.scvMap(
    Object.keys(entries)
      .sort()
      .map(
        (key) => new xdr.ScMapEntry({ key: symbol(key), val: entries[key] }),
      ),
  );

class KiteStellarContract {
  toScVal = (t: StellarKiteTransfer) => {
    return map({
      id: bytes(t.id),
      pay_in: address(t.pay_in),
      amount_in: i128(t.amount_in),
      settlement_token: address(t.settlement_token),
      settlement_recipient: address(t.settlement_recipient),
      min_amount_out: i128(t.min_amount_out),
      fees: xdr.ScVal.scvVec(
        t.fees.map((fee) =>
          map({ recipient: address(fee.recipient), amount: i128(fee.amount) }),
        ),
      ),
      refund_address: address(t.refund_address),
      expires_at: xdr.ScVal.scvU64(xdr.Uint64.fromString(t.expires_at)),
      swap: xdr.ScVal.scvVec(
        t.swap
          ? [
              symbol("Some"),
              map({
                router: address(t.swap.router),
                path: xdr.ScVal.scvVec(t.swap.path.map(address)),
              }),
            ]
          : [symbol("None")],
      ),
      implementation: bytes(t.implementation),
    });
  };

  salt = (t: StellarKiteTransfer) => hash(this.toScVal(t).toXDR());

  predictAddress = (
    factory: string,
    t: StellarKiteTransfer,
    networkPassphrase: string,
  ) => {
    const error = this.validateTransferInput(t);
    if (error) throw new AppError(error);

    const preimage = xdr.HashIdPreimage.envelopeTypeContractId(
      new xdr.HashIdPreimageContractId({
        networkId: hash(Buffer.from(networkPassphrase)),
        contractIdPreimage:
          xdr.ContractIdPreimage.contractIdPreimageFromAddress(
            new xdr.ContractIdPreimageFromAddress({
              address: Address.fromString(factory).toScAddress(),
              salt: this.salt(t),
            }),
          ),
      }),
    );

    return StrKey.encodeContract(hash(preimage.toXDR()));
  };

  buildTransferInput = (input: {
    transferId: string;
    payInToken: string;
    amountIn: bigint;
    settlementToken: string;
    settlementRecipient: string;
    minAmountOut: bigint;
    fees: Array<{ id: string; recipient: string; amount: bigint }>;
    refundAddress: string;
    expiresAt: Date;
    swap: StellarKiteTransfer["swap"];
    implementation: string;
  }): StellarKiteTransfer => {
    return {
      id: common.uuidToBytes32(input.transferId).slice(2),
      pay_in: input.payInToken,
      amount_in: input.amountIn.toString(),
      settlement_token: input.settlementToken,
      settlement_recipient: input.settlementRecipient,
      min_amount_out: input.minAmountOut.toString(),
      fees: this.sortFees(input.fees).map((fee) => ({
        recipient: fee.recipient,
        amount: fee.amount.toString(),
      })),
      refund_address: input.refundAddress,
      expires_at: Math.floor(input.expiresAt.getTime() / 1000).toString(),
      swap: input.payInToken === input.settlementToken ? null : input.swap,
      implementation: input.implementation,
    };
  };

  sortFees = <T extends { id: string }>(fees: T[]) =>
    [...fees].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  validateTransferInput = (
    t: StellarKiteTransfer,
    sac: { payIn: boolean; settlement: boolean } = {
      payIn: true,
      settlement: true,
    },
  ) => {
    for (const token of [t.pay_in, t.settlement_token]) {
      if (!isStellarContract(token)) return `${token} is not a token contract`;
    }

    const recipients = [
      { address: t.settlement_recipient, sac: sac.settlement },
      ...t.fees.map((fee) => ({ address: fee.recipient, sac: sac.settlement })),
      { address: t.refund_address, sac: sac.payIn },
    ];
    for (const recipient of recipients) {
      if (!isStellarAddress(recipient.address)) {
        return `${recipient.address} is not a valid Stellar address`;
      }
      if (isStellarMuxed(recipient.address) && !recipient.sac) {
        return `${recipient.address} is a muxed address, which only Stellar Asset Contract tokens can pay`;
      }
    }

    if (!/^[0-9a-f]{64}$/.test(t.id) || /^0+$/.test(t.id)) {
      return "The transfer id is invalid";
    }

    if (!/^[0-9a-f]{64}$/.test(t.implementation)) {
      return "The implementation hash is invalid";
    }

    if (BigInt(t.amount_in) <= 0n || BigInt(t.min_amount_out) <= 0n) {
      return "The amount must be greater than zero";
    }

    if (t.fees.length > KiteMaxFees) {
      return `At most ${KiteMaxFees} fees can apply to a transfer (${t.fees.length} matched)`;
    }

    if (t.fees.some((fee) => BigInt(fee.amount) <= 0n)) {
      return "Every fee must be greater than zero";
    }

    const totalFees = t.fees.reduce((total, f) => total + BigInt(f.amount), 0n);
    if (BigInt(t.min_amount_out) < totalFees) {
      return "Fees amount exceed the minimum settlement amount";
    }

    const sameToken = t.pay_in === t.settlement_token;
    if (sameToken && t.swap) {
      return "A transfer in the settlement token has no swap";
    }

    if (!sameToken) {
      if (!t.swap) {
        return "A swap router is required to settle in a different token";
      }

      const { path, router } = t.swap;
      if (
        !isStellarContract(router) ||
        path.length < 2 ||
        path.length > StellarMaxPath ||
        path[0] !== t.pay_in ||
        path.at(-1) !== t.settlement_token ||
        !path.every(isStellarContract)
      ) {
        return "The swap route is invalid";
      }
    }

    return null;
  };

  status = (value: xdr.ScVal): StellarKiteStatus => {
    const [status] = scValToNative(value) as [StellarKiteStatus];
    return status;
  };

  errorName = (message: string) => {
    const code = /Error\(Contract, #(\d+)\)/.exec(message)?.[1];
    return code ? (StellarKiteErrors[Number(code)] ?? null) : null;
  };

  parseEvents = (
    caip2Id: Caip2Id,
    transactionHash: string,
    events: xdr.ContractEvent[],
    feeIds: string[],
  ) => {
    const items: OnchainNotifierCallbackResult = [];
    const id = (value: Buffer) => `0x${value.toString("hex")}` as const;

    events.forEach((event, index) => {
      const contractId = event.contractId();
      if (!contractId) return;

      const body = event.body().v0();
      const topics = body.topics().map((topic) => scValToNative(topic));
      if (topics[0] !== "kite") return;

      const data = scValToNative(body.data()) as Record<string, any>;
      const base = {
        caip2Id,
        blockchainHash: transactionHash,
        logIndex: String(index),
        payinAddress: StrKey.encodeContract(contractId as unknown as Buffer),
      };

      switch (topics[1]) {
        case "settled":
          items.push({
            ...base,
            type: "Settled",
            transferId: id(data.transfer_id),
          });
          break;

        case "fee_paid": {
          const feeId = feeIds[Number(data.index)];
          if (!feeId) break;
          items.push({
            ...base,
            type: "FeePaid",
            transferId: id(data.transfer_id),
            feeId: common.uuidToBytes32(feeId),
          });
          break;
        }

        case "refunded":
          items.push({
            ...base,
            type: "Refunded",
            transferId: id(data.transfer_id),
            refundAddress: data.refund_address,
            amountRefunded: BigInt(data.amount_refunded),
          });
          break;

        case "excess_refunded":
        case "recovered":
          items.push({
            ...base,
            type: topics[1] === "recovered" ? "Recovered" : "ExcessRefunded",
            transferId: id(data.transfer_id),
            tokenAddress: data.token,
            amount: BigInt(data.amount),
            to: data.to,
          });
          break;
      }
    });

    return items;
  };
}

export const kiteStellar = new KiteStellarContract();
