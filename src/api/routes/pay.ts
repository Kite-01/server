import {
  decodePaymentSignatureHeader,
  encodePaymentRequiredHeader,
  encodePaymentResponseHeader,
} from "@x402/core/http";
import {
  type PaymentPayload,
  type PaymentRequired,
  type SettleResponse,
} from "@x402/core/types";
import {
  NotFoundError,
  PreconditionError,
  QuoteExpiredError,
} from "../../shared/errors";
import { CheckoutService } from "../../services/Checkout.service";
import { Elysia } from "elysia";
import { env } from "../../shared/env";

const checkoutService = new CheckoutService();

const PayPath =
  /^\/pay\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/?$/i;

const x402LinkId = (request: Request) => {
  if (request.method !== "GET") {
    return null;
  }

  const id = PayPath.exec(new URL(request.url).pathname)?.[1];
  if (!id) {
    return null;
  }

  const accept = request.headers.get("accept") ?? "";
  const isX402 =
    request.headers.has("PAYMENT-SIGNATURE") || !accept.includes("text/html");

  return isX402 ? id.toLowerCase() : null;
};

const json = (
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
) => {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store",
      ...headers,
    },
  });
};

const resourceUrl = (id: string) => {
  return new URL(`/pay/${id}`, env.KITE_PUBLIC_BASE_URL).toString();
};

const statusUrl = (id: string, transferId: string) => {
  const url = new URL(
    `/api/checkout/${id}/transfer/${transferId}`,
    env.KITE_PUBLIC_BASE_URL,
  );

  return url.toString();
};

const completedUrl = (returnUrl: string, transferId: string) => {
  const url = new URL(returnUrl);
  url.searchParams.set("status", "completed");
  url.searchParams.set("transferId", transferId);

  return url.toString();
};

const challenge = async (id: string, error?: string) => {
  const offer = await checkoutService.offerX402(id);
  const required: PaymentRequired = {
    x402Version: 2,
    resource: {
      url: resourceUrl(id),
      description: offer.title,
      mimeType: "application/json",
    },
    accepts: offer.accepts,
    ...(error ? { error } : {}),
  };

  return json(402, required, {
    "PAYMENT-REQUIRED": encodePaymentRequiredHeader(required),
  });
};

const settle = async (id: string, payment: PaymentPayload) => {
  const transferId = await checkoutService.getX402TransferId(
    id,
    payment.accepted.payTo,
  );

  let result: SettleResponse = await checkoutService.settleX402Payment(
    id,
    payment,
    payment.accepted,
  );

  // Once more, as x402 servers do: it reconciles with what was broadcast.
  if (!result.success && result.errorReason === "settlement_pending") {
    result = await checkoutService.settleX402Payment(
      id,
      payment,
      payment.accepted,
    );
  }

  const headers = {
    "PAYMENT-RESPONSE": encodePaymentResponseHeader(result),
    "X-Kite-Transfer-Id": transferId,
  };

  if (result.success) {
    const receipt = await checkoutService.getReceipt(id);

    return json(
      200,
      {
        paymentLinkId: id,
        transferId,
        merchant: receipt.merchant,
        title: receipt.title,
        amount: receipt.amount,
        currency: receipt.currency,
        lineItems: receipt.lineItems,
        transaction: result.transaction,
        network: result.network,
        payer: result.payer,
        status: statusUrl(id, transferId),
        returnUrl: receipt.returnUrl
          ? completedUrl(receipt.returnUrl, transferId)
          : null,
      },
      headers,
    );
  }

  // still pending: retrying with the same signature picks it up.
  if (result.errorReason === "settlement_pending") {
    return json(402, {}, headers);
  }

  return challenge(id, result.errorMessage ?? result.errorReason);
};

const pay = async (request: Request, id: string) => {
  const signature = request.headers.get("PAYMENT-SIGNATURE");
  if (!signature) {
    return challenge(id);
  }

  let payment: PaymentPayload;

  try {
    payment = decodePaymentSignatureHeader(signature);
  } catch {
    return json(400, {
      error: {
        code: "BadRequest",
        message: "Invalid PAYMENT-SIGNATURE header",
      },
    });
  }

  if (payment.x402Version !== 2 || !payment.accepted) {
    return challenge(id, "Only x402 version 2 payments are accepted");
  }

  if (payment.resource && payment.resource.url !== resourceUrl(id)) {
    return challenge(id, "Payment resource mismatch");
  }

  try {
    return await settle(id, payment);
  } catch (error) {
    if (
      error instanceof PreconditionError ||
      error instanceof QuoteExpiredError ||
      (error instanceof NotFoundError && error.resource === "transfer")
    ) {
      return challenge(id, error.message);
    }

    throw error;
  }
};

export const payLinkRoutes = new Elysia({ name: "PayLinkRoute" }).onRequest(
  ({ request }) => {
    const id = x402LinkId(request);
    if (id) return pay(request, id);
  },
);
