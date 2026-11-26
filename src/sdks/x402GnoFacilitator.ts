import { createHash } from "node:crypto";
import { secp256k1 } from "@noble/curves/secp256k1";
import { MsgEndpoint, MsgSend, decodeTxMessages } from "@gnolang/gno-js-client";
import {
  PubKeySecp256k1,
  Secp256k1PubKeyType,
  TransactionEndpoint,
  Tx,
  encodeCharacterSet,
  parseSignCoin,
  sortedJsonStringify,
  stringToUTF8,
} from "@gnolang/tm2-js-client";
import type {
  PaymentPayload,
  PaymentRequirements,
  SchemeNetworkFacilitator,
  SettleResponse,
  VerifyResponse,
} from "@x402/core/types";
import { getX402Observer } from "../shared/context/x402";
import { GnoNativeToken, gnoPubKeyAddress } from "../shared/gnoAddress";
import { type GnoActor } from "./GnoActor";

export const SettlePolling = { attempts: 10, ms: 1000 };

export type GnoPayment = {
  bytes: Buffer;
  tx: Tx;
  from: string;
  to: string;
  amount: string;
  hash: string;
};

// a payment from @gnolang/x402: a signed, unbroadcast std.Tx with one bank.MsgSend
export const decodeGnoPayment = (transaction: string): GnoPayment | null => {
  try {
    const bytes = Buffer.from(transaction, "base64");
    const tx = Tx.decode(bytes);
    const [message] = tx.messages;
    if (tx.messages.length !== 1 || message.type_url !== MsgEndpoint.MSG_SEND) {
      return null;
    }
    const send = MsgSend.decode(message.value);
    return {
      bytes,
      tx,
      from: send.from_address,
      to: send.to_address,
      amount: send.amount,
      hash: createHash("sha256").update(bytes).digest("hex").toUpperCase(),
    };
  } catch {
    return null;
  }
};

const invalid = (invalidReason: string, invalidMessage: string) =>
  ({ isValid: false, invalidReason, invalidMessage }) as const;

// verifies and broadcasts what the payer signed, as gnolang/x402's facilitator does; it holds no key
export class ExactGnoFacilitator implements SchemeNetworkFacilitator {
  readonly scheme = "exact";
  readonly caipFamily = "gno:*";

  constructor(
    private readonly actor: GnoActor,
    private readonly rpcUrls: string[] = [],
  ) {}

  getExtra = () => ({ areFeesSponsored: false });

  getSigners = () => [];

  verify = async (
    payload: PaymentPayload,
    requirements: PaymentRequirements,
  ): Promise<VerifyResponse> => {
    const payment = decodeGnoPayment(String(payload.payload.transaction));
    if (!payment) {
      return invalid(
        "invalid_payload",
        "The payment must be a signed transaction with one bank send",
      );
    }

    const payer = payment.from;
    if (requirements.asset !== GnoNativeToken) {
      return invalid("invalid_payload", "x402 on Gno pays in ugnot only");
    }
    if (payment.to !== requirements.payTo) {
      return {
        ...invalid("invalid_payload", "The payment isn't to payTo"),
        payer,
      };
    }
    if (payment.amount !== `${requirements.amount}${GnoNativeToken}`) {
      return {
        ...invalid("invalid_payload", "The payment amount doesn't match"),
        payer,
      };
    }

    const [signature] = payment.tx.signatures;
    if (
      payment.tx.signatures.length !== 1 ||
      signature.session_addr ||
      signature.pub_key?.type_url !== Secp256k1PubKeyType
    ) {
      return {
        ...invalid(
          "invalid_payload",
          "The payment must carry one secp256k1 signature from its sender",
        ),
        payer,
      };
    }

    const publicKey = PubKeySecp256k1.decode(signature.pub_key.value).key;
    if (gnoPubKeyAddress(publicKey) !== payer) {
      return {
        ...invalid("invalid_payload", "The signer isn't the sender"),
        payer,
      };
    }

    const provider = await this.actor.provider(
      requirements.network as Caip2Id,
      this.rpcUrls,
    );
    const account = await provider.getAccount(payer).catch(() => null);
    if (!account) {
      return {
        ...invalid("insufficient_funds", "The payer's account doesn't exist"),
        payer,
      };
    }

    const fee = payment.tx.fee!;
    const signBytes = stringToUTF8(
      encodeCharacterSet(
        sortedJsonStringify({
          chain_id: requirements.network.replace(/^gno:/, ""),
          account_number: account.BaseAccount.account_number,
          sequence: account.BaseAccount.sequence,
          fee: {
            amount: parseSignCoin(fee.gas_fee),
            gas: fee.gas_wanted.toString(10),
          },
          msgs: decodeTxMessages(payment.tx.messages),
          memo: payment.tx.memo,
        }),
      ),
    );
    const digest = createHash("sha256").update(signBytes).digest();
    if (!secp256k1.verify(signature.signature, digest, publicKey)) {
      return {
        ...invalid(
          "invalid_exact_gno_payload_signature",
          "The signature doesn't match this chain and the payer's next sequence",
        ),
        payer,
      };
    }

    const [gasFee] = parseSignCoin(fee.gas_fee);
    const needed =
      BigInt(requirements.amount) +
      (gasFee?.denom === GnoNativeToken ? BigInt(gasFee.amount) : 0n);
    const balance = await this.actor.getBalance(
      requirements.network as Caip2Id,
      GnoNativeToken,
      payer,
      this.rpcUrls,
    );
    if (balance < needed) {
      return {
        ...invalid(
          "insufficient_funds",
          "The payer can't cover the amount and the fee",
        ),
        payer,
      };
    }

    return { isValid: true, payer };
  };

  settle = async (
    payload: PaymentPayload,
    requirements: PaymentRequirements,
  ): Promise<SettleResponse> => {
    const network = requirements.network;
    const verification = await this.verify(payload, requirements);
    if (!verification.isValid) {
      return {
        success: false,
        errorReason: verification.invalidReason,
        errorMessage: verification.invalidMessage,
        payer: verification.payer,
        transaction: "",
        network,
      };
    }

    const payment = decodeGnoPayment(String(payload.payload.transaction))!;
    const provider = await this.actor.provider(
      network as Caip2Id,
      this.rpcUrls,
    );
    await getX402Observer()?.onBroadcast(payment.hash);

    try {
      await provider.sendTransaction(
        payment.bytes.toString("base64"),
        TransactionEndpoint.BROADCAST_TX_SYNC,
      );
    } catch (e) {
      return {
        success: false,
        errorReason: "transaction_failed",
        errorMessage: e instanceof Error ? e.message : String(e),
        payer: payment.from,
        transaction: payment.hash,
        network,
      };
    }

    for (let attempt = 0; attempt < SettlePolling.attempts; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, SettlePolling.ms));
      const status = await this.actor.getTransactionStatus(
        network as Caip2Id,
        payment.hash,
      );
      if (status.status === "pending") continue;

      return status.status === "success"
        ? {
            success: true,
            payer: payment.from,
            transaction: payment.hash,
            network,
          }
        : {
            success: false,
            errorReason: "transaction_failed",
            payer: payment.from,
            transaction: payment.hash,
            network,
          };
    }

    return {
      success: false,
      errorReason: "settlement_pending",
      payer: payment.from,
      transaction: payment.hash,
      network,
    };
  };
}
