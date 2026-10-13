import { EvmAddress, Uuid, UuidIdParams } from "../schema";
import { CheckoutService } from "../../services/Checkout.service";
import { models } from "../models";
import { Elysia } from "elysia";
import { Auth } from "../middlewares/auth";
import { t } from "../schema";

const checkoutService = new CheckoutService();

export const checkoutRoutes = new Elysia({
  name: "CheckoutRoute",
  prefix: "/checkout",
})
  .use(models)
  .onParse(Auth.parseJson)
  .get("/:id", ({ params }) => checkoutService.getCheckout(params.id), {
    params: UuidIdParams,
    response: {
      200: "Checkout",
    },
    detail: {
      tags: ["Checkout"],
      summary: "What a payment link charges and how it can be paid",
    },
  })
  .post(
    "/:id/quote",
    async ({ params, body, set }) => {
      const created = await checkoutService.createQuote(params.id, body);

      set.status = 201;
      return created;
    },
    {
      params: UuidIdParams,
      parse: "json",
      body: t.Object({
        chainId: Uuid,
        sourceTokenAddress: EvmAddress,
      }),
      response: {
        201: "Quote",
      },
      detail: {
        tags: ["Checkout"],
        summary: "Quote a payment link in a token",
      },
    },
  )
  .post(
    "/:id/transfer",
    async ({ params, body, set }) => {
      const created = await checkoutService.createTransfer(
        params.id,
        body.quoteId,
        body.refundAddress,
      );

      set.status = 201;
      return created;
    },
    {
      params: UuidIdParams,
      parse: "json",
      body: t.Object({
        quoteId: Uuid,
        refundAddress: EvmAddress,
      }),
      response: {
        201: "CreatedTransfer",
      },
      detail: {
        tags: ["Checkout"],
        summary: "Open a transfer to be paid by sending tokens",
      },
    },
  )
  .post(
    "/:id/x402",
    async ({ params, body, set }) => {
      const created = await checkoutService.createX402Payment(
        params.id,
        body.quoteId,
        body.refundAddress,
      );

      set.status = 201;
      return created;
    },
    {
      params: UuidIdParams,
      parse: "json",
      body: t.Object({
        quoteId: Uuid,
        refundAddress: t.Optional(EvmAddress),
      }),
      response: {
        201: "CheckoutX402Payment",
      },
      detail: {
        tags: ["Checkout"],
        summary: "Open a transfer to be paid with an x402 authorization",
      },
    },
  )
  .post(
    "/:id/x402/settle",
    ({ params, body }) => {
      return checkoutService.settleX402Payment(
        params.id,
        body.paymentPayload,
        body.paymentRequirements,
      );
    },
    {
      params: UuidIdParams,
      parse: "json",
      body: t.Object({
        x402Version: t.Optional(t.Number()),
        paymentPayload: t.Any(),
        paymentRequirements: t.Any(),
      }),
      response: {
        200: "x402SettleResult",
      },
      detail: {
        tags: ["Checkout"],
        summary: "Settle a signed x402 authorization",
      },
    },
  )
  .get(
    "/:id/transfer/:transferId",
    ({ params }) => {
      return checkoutService.getTransfer(params.id, params.transferId);
    },
    {
      params: t.Object({
        id: Uuid,
        transferId: Uuid,
      }),
      response: {
        200: "CheckoutTransfer",
      },
      detail: {
        tags: ["Checkout"],
        summary: "Track a transfer opened from a payment link",
      },
    },
  );
