import { UuidIdParams, Uuid } from "../schema";
import { x402Service } from "../../services/x402.service";
import { ApiKeyScope } from "../../shared/constants";
import { models } from "../models";
import { Elysia } from "elysia";
import { Auth } from "../middlewares/auth";
import { t } from "../schema";

const x402 = new x402Service();

const PaymentBody = t.Object({
  x402Version: t.Optional(t.Number()),
  paymentPayload: t.Any(),
  paymentRequirements: t.Any(),
});

export const x402Routes = new Elysia({ name: "x402Route", prefix: "/x402" })
  .use(Auth.plugin)
  .use(models)
  .get("/supported", () => x402.getSupported(), {
    response: {
      200: "x402Supported",
    },
    detail: {
      operationId: "x402.supported",
      tags: ["x402"],
      summary: "Payment kinds this facilitator supports",
    },
  })
  .post(
    "/pay",
    async ({ actor, body, set }) => {
      const created = await x402.createTransfer(
        Auth.requireAppId(actor),
        body.quoteId,
      );

      set.status = 201;
      return created;
    },
    {
      beforeHandle: Auth.access({ scope: ApiKeyScope.x402 }),
      parse: "json",
      body: t.Object({
        quoteId: Uuid,
      }),
      response: {
        201: "CreatedTransfer",
      },
      detail: {
        operationId: "x402.pay",
        tags: ["x402"],
        summary: "Open a transfer to be paid with x402",
      },
    },
  )
  .get(
    "/transfer/:id/requirements",
    ({ actor, params }) => {
      return x402.getPaymentRequirements(Auth.requireAppId(actor), params.id);
    },
    {
      params: UuidIdParams,
      beforeHandle: Auth.access({ scope: ApiKeyScope.x402 }),
      response: {
        200: "x402PaymentRequirements",
      },
      detail: {
        operationId: "x402.requirements",
        tags: ["x402"],
        summary: "Payment requirements for a transfer",
      },
    },
  )
  .post(
    "/verify",
    ({ actor, body }) => {
      return x402.verify(
        Auth.requireAppId(actor),
        body.paymentPayload,
        body.paymentRequirements,
      );
    },
    {
      parse: "json",
      body: PaymentBody,
      response: {
        200: "x402VerifyResult",
      },
      beforeHandle: Auth.access({ scope: ApiKeyScope.x402 }),
      detail: {
        operationId: "x402.verify",
        tags: ["x402"],
        summary: "Verify an x402 payment",
      },
    },
  )
  .post(
    "/settle",
    ({ actor, body }) => {
      return x402.settle(
        Auth.requireAppId(actor),
        body.paymentPayload,
        body.paymentRequirements,
      );
    },
    {
      parse: "json",
      body: PaymentBody,
      response: {
        200: "x402SettleResult",
      },
      beforeHandle: Auth.access({ scope: ApiKeyScope.x402 }),
      detail: {
        operationId: "x402.settle",
        tags: ["x402"],
        summary: "Settle an x402 payment",
      },
    },
  );
