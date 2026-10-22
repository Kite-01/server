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
      operationId: "checkout.get",
      security: [],
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
        operationId: "checkout.quote",
        security: [],
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
        operationId: "checkout.openTransfer",
        security: [],
        tags: ["Checkout"],
        summary: "Open a transfer to be paid by sending tokens",
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
        operationId: "checkout.getTransfer",
        security: [],
        tags: ["Checkout"],
        summary: "Track a transfer opened from a payment link",
      },
    },
  )
  .post(
    "/:id/transfer/:transferId/cancel",
    async ({ params }) => {
      return checkoutService.cancelTransfer(params.id, params.transferId);
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
        operationId: "checkout.cancelTransfer",
        security: [],
        tags: ["Checkout"],
        summary: "Cancel a transfer that hasn't been paid",
      },
    },
  );
