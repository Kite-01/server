import { keccak256, toHex } from "viem";
import { AppError } from "./errors";
import { KiteMaxFees } from "./constants";

/**
 * The `kite-factory` / `kite-deposit` contracts on NEAR (Kite-01/contracts, `near/`).
 *
 * A deposit account's id is `0s` + the last 20 bytes of keccak256(borsh(StateInit)), where the
 * StateInit runs the transfer's `implementation` (a global contract code hash) with
 * `{factory, transfer, status: Open, progress: default}` stored under `STATE` (NEP-616). The
 * serializer below must match `kite_types::DepositState` field for field.
 */

export type NearAsset = "Native" | { Token: string };

export type NearSwapPool = { Dcl: string } | { RefV1: string };

export type NearKiteTransfer = {
  id: string;
  pay_in: NearAsset;
  amount_in: string;
  settlement_token: NearAsset;
  settlement_recipient: string;
  min_amount_out: string;
  fees: Array<{ id: string; recipient: string; amount: string }>;
  refund_account: string;
  expires_at: string;
  swap: { router: string; pool: NearSwapPool; wrap: string } | null;
  implementation: string;
};

export type NearKiteStatus =
  "Uninitialized" | "Open" | "Executing" | "Settled" | "Refunded";

/** The token address Kite stores for native NEAR, as the zero address is for native ETH. */
export const NearNativeToken = "near";

const MaxIdLength = 64;

const BASE58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

const base58Decode = (value: string) => {
  let n = 0n;
  for (const char of value) {
    const digit = BASE58.indexOf(char);
    if (digit < 0) throw new AppError(`Invalid base58: ${value}`);
    n = n * 58n + BigInt(digit);
  }

  const bytes: number[] = [];
  while (n > 0n) {
    bytes.unshift(Number(n & 0xffn));
    n >>= 8n;
  }

  for (const char of value) {
    if (char !== "1") break;
    bytes.unshift(0);
  }

  return Uint8Array.from(bytes);
};

class BorshWriter {
  private bytes: number[] = [];

  u8 = (v: number) => {
    this.bytes.push(v & 0xff);
    return this;
  };

  uint = (v: bigint, size: number) => {
    if (v < 0n || v >= 1n << BigInt(size * 8)) {
      throw new AppError(`Value out of range for u${size * 8}: ${v}`);
    }
    for (let i = 0; i < size; i++) {
      this.bytes.push(Number((v >> BigInt(8 * i)) & 0xffn));
    }
    return this;
  };

  u32 = (v: number) => this.uint(BigInt(v), 4);
  u64 = (v: bigint | string) => this.uint(BigInt(v), 8);
  u128 = (v: bigint | string) => this.uint(BigInt(v), 16);

  fixed = (b: Uint8Array) => {
    this.bytes.push(...b);
    return this;
  };

  vecBytes = (b: Uint8Array) => this.u32(b.length).fixed(b);

  string = (s: string) => this.vecBytes(new TextEncoder().encode(s));

  done = () => Uint8Array.from(this.bytes);
}

const writeAsset = (w: BorshWriter, asset: NearAsset) => {
  if (asset === "Native") w.u8(0);
  else w.u8(1).string(asset.Token);
};

export const isNearAccountId = (value: string) => {
  return (
    value.length >= 2 &&
    value.length <= 64 &&
    /^(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/.test(value)
  );
};

class KiteNearContract {
  serializeState = (factory: string, t: NearKiteTransfer) => {
    const w = new BorshWriter();
    w.string(factory);

    w.string(t.id);
    writeAsset(w, t.pay_in);
    w.u128(t.amount_in);
    writeAsset(w, t.settlement_token);
    w.string(t.settlement_recipient);
    w.u128(t.min_amount_out);
    w.u32(t.fees.length);
    for (const fee of t.fees) {
      w.string(fee.id).string(fee.recipient).u128(fee.amount);
    }
    w.string(t.refund_account);
    w.u64(t.expires_at);
    if (!t.swap) {
      w.u8(0);
    } else {
      w.u8(1).string(t.swap.router);
      if ("Dcl" in t.swap.pool) w.u8(0).string(t.swap.pool.Dcl);
      else w.u8(1).u64(t.swap.pool.RefV1);
      w.string(t.swap.wrap);
    }
    w.fixed(this.codeHash(t.implementation));

    // status: Open
    w.u8(1);
    // progress: step, excess, out_before, amount_out, wrapped, paid, lock_until
    w.u8(0).u128(0n).u128(0n).u128(0n).u8(0).uint(0n, 2).u64(0n);

    return w.done();
  };

  codeHash = (implementation: string) => {
    const hash = base58Decode(implementation);
    if (hash.length !== 32) {
      throw new AppError(`Invalid code hash: ${implementation}`);
    }
    return hash;
  };

  predictAddress = (factory: string, t: NearKiteTransfer) => {
    const error = this.validateTransferInput(t);
    if (error) throw new AppError(error);

    const stateInit = new BorshWriter()
      // StateInit::V1, GlobalContractId::CodeHash
      .u8(0)
      .u8(0)
      .fixed(this.codeHash(t.implementation))
      // data: one entry, STATE
      .u32(1)
      .string("STATE")
      .vecBytes(this.serializeState(factory, t))
      .done();

    return `0s${keccak256(toHex(stateInit)).slice(2 + 24)}`;
  };

  buildTransferInput = (input: {
    transferId: string;
    payInToken: string;
    amountIn: bigint;
    settlementToken: string;
    settlementRecipient: string;
    minAmountOut: bigint;
    fees: Array<{ id: string; recipient: string; amount: bigint }>;
    refundAccount: string;
    expiresAt: Date;
    swap: NearKiteTransfer["swap"];
    implementation: string;
  }): NearKiteTransfer => {
    const asset = (token: string): NearAsset =>
      token === NearNativeToken ? "Native" : { Token: token };

    return {
      id: input.transferId,
      pay_in: asset(input.payInToken),
      amount_in: input.amountIn.toString(),
      settlement_token: asset(input.settlementToken),
      settlement_recipient: input.settlementRecipient,
      min_amount_out: input.minAmountOut.toString(),
      fees: [...input.fees]
        .sort((a, b) => a.id.localeCompare(b.id))
        .map((fee) => ({
          id: fee.id,
          recipient: fee.recipient,
          amount: fee.amount.toString(),
        })),
      refund_account: input.refundAccount,
      expires_at: Math.floor(input.expiresAt.getTime() / 1000).toString(),
      swap: input.payInToken === input.settlementToken ? null : input.swap,
      implementation: input.implementation,
    };
  };

  /** The same rules as `Transfer::validate` in `kite-types`. */
  validateTransferInput = (t: NearKiteTransfer) => {
    const accounts = [
      t.settlement_recipient,
      t.refund_account,
      ...t.fees.map((f) => f.recipient),
    ];
    for (const account of accounts) {
      if (!isNearAccountId(account)) {
        return `${account} is not a valid NEAR account`;
      }
    }

    if (!t.id || t.id.length > MaxIdLength) {
      return "The transfer id is invalid";
    }

    if (t.fees.length > KiteMaxFees) {
      return `At most ${KiteMaxFees} fees can apply to a transfer (${t.fees.length} matched)`;
    }

    for (const fee of t.fees) {
      if (BigInt(fee.amount) === 0n)
        return "Every fee must be greater than zero";
      if (!fee.id || fee.id.length > MaxIdLength) return "A fee id is invalid";
    }

    if (BigInt(t.amount_in) === 0n) {
      return "The amount must be greater than zero";
    }

    const totalFees = t.fees.reduce((total, f) => total + BigInt(f.amount), 0n);
    if (BigInt(t.min_amount_out) < totalFees) {
      return "Fees amount exceed the minimum settlement amount";
    }

    const sameToken =
      JSON.stringify(t.pay_in) === JSON.stringify(t.settlement_token);
    if (!sameToken) {
      if (!t.swap) {
        return "A swap router is required to settle in a different token";
      }

      const wrap = JSON.stringify({ Token: t.swap.wrap });
      const pair = [
        JSON.stringify(t.pay_in),
        JSON.stringify(t.settlement_token),
      ];
      if (pair.includes('"Native"') && pair.includes(wrap)) {
        return "Native and wrapped NEAR are the same token";
      }
    }

    return null;
  };

  /** Fungible tokens the deposit account is registered on when it's deployed. */
  tokensToRegister = (t: NearKiteTransfer) => {
    const tokens = new Set<string>();
    if (t.pay_in !== "Native") tokens.add(t.pay_in.Token);
    if (t.settlement_token !== "Native") tokens.add(t.settlement_token.Token);
    if (t.swap && (t.pay_in === "Native" || t.settlement_token === "Native")) {
      tokens.add(t.swap.wrap);
    }
    return [...tokens];
  };

  payInToken = (t: NearKiteTransfer) =>
    t.pay_in === "Native" ? NearNativeToken : t.pay_in.Token;
}

export const kiteNear = new KiteNearContract();
