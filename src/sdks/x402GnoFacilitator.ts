import {
  MsgEndpoint,
  MsgSend,
  decodeTxMessages,
  type SessionAccountInfo,
} from "@gnolang/gno-js-client";
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
import { GnoNativeToken, gnoPubKeyAddress } from "../shared/gnoAddress";
import { getX402Observer } from "../shared/context/x402";
import { type GnoActor } from "./GnoActor";
import { createHash } from "node:crypto";
import { secp256k1 } from "@noble/curves/secp256k1";

export const SettlePolling = {
  attempts: 10,
  ms: 1000,
};

export type GnoPayment = {
  bytes: Buffer;
  tx: Tx;
  from: string;
  to: string;
  amount: string;
  hash: string;
};

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

export const sessionRefusal = (
  session: SessionAccountInfo,
  spend: bigint,
  now = Math.floor(Date.now() / 1000),
) => {
  if (session.expires_at && now >= session.expires_at) {
    return "The session has expired";
  }

  const paths = session.allow_paths ?? [];
  if (!paths.includes("*") && !paths.includes("bank/send")) {
    return "The session isn't allowed to send coins";
  }

  const ugnot = (coins?: string) =>
    (coins ?? "")
      .split(",")
      .map((coin) => /^(\d+)ugnot$/.exec(coin.trim())?.[1])
      .reduce((total, amount) => total + BigInt(amount ?? 0), 0n);

  const reset =
    !!session.spend_period &&
    now >= (session.spend_reset ?? 0) + session.spend_period;

  const used = reset ? 0n : ugnot(session.spend_used);
  if (!session.spend_limit || used + spend > ugnot(session.spend_limit)) {
    return "The payment and its fee exceed the session's spend limit";
  }

  return null;
};

const invalid = (invalidReason: string, invalidMessage: string) => {
  return { isValid: false, invalidReason, invalidMessage } as const;
};

export class ExactGnoFacilitator implements SchemeNetworkFacilitator {
  readonly scheme = "exact";
  readonly caipFamily = "gno:*";

  constructor(
    private readonly actor: GnoActor,
    private readonly rpcUrls: string[] = [],
  ) {}

  getExtra = () => ({
    areFeesSponsored: false,
  });

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
      signature.pub_key?.type_url !== Secp256k1PubKeyType
    ) {
      return {
        ...invalid(
          "invalid_payload",
          "The payment must carry one secp256k1 signature",
        ),
        payer,
      };
    }

    const session = signature.session_addr;
    const publicKey = PubKeySecp256k1.decode(signature.pub_key.value).key;
    if (gnoPubKeyAddress(publicKey) !== (session || payer)) {
      return {
        ...invalid(
          "invalid_payload",
          session
            ? "The signer isn't the session's key"
            : "The signer isn't the sender",
        ),
        payer,
      };
    }

    const fee = payment.tx.fee!;
    const [gasFee] = parseSignCoin(fee.gas_fee);
    const needed =
      BigInt(requirements.amount) +
      (gasFee?.denom === GnoNativeToken ? BigInt(gasFee.amount) : 0n);

    const provider = await this.actor.provider(
      requirements.network as Caip2Id,
      this.rpcUrls,
    );

    let signer: { account_number?: string; sequence?: string } | null;
    if (session) {
      const info = await provider.getSession(payer, session).catch(() => null);
      const refusal = info
        ? sessionRefusal(info, needed)
        : "The payer has no such session";

      if (refusal) {
        return {
          ...invalid("invalid_exact_gno_session", refusal),
          payer,
        };
      }

      signer = info;
    } else {
      signer = await provider
        .getAccount(payer)
        .then((account) => account.BaseAccount)
        .catch(() => null);
    }

    if (!signer?.account_number || !signer.sequence) {
      return {
        ...invalid("insufficient_funds", "The payer's account doesn't exist"),
        payer,
      };
    }

    const signBytes = stringToUTF8(
      encodeCharacterSet(
        sortedJsonStringify({
          chain_id: requirements.network.replace(/^gno:/, ""),
          account_number: signer.account_number,
          sequence: signer.sequence,
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
          "The signature doesn't match this chain and the signer's next sequence",
        ),
        payer,
      };
    }

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

    return {
      isValid: true,
      payer,
    };
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

      if (status.status === "pending") {
        continue;
      }

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
