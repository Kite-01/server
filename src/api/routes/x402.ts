import { UuidIdParams, Uuid } from "../schema";
import { x402Service } from "../../services/x402.service";
import { ApiKeyScope } from "../../shared/constants";
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
  .get("/supported", () => x402.getSupported(), {
    beforeHandle: Auth.access({ public: true }),
    detail: {
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
      body: t.Object({
        quoteId: Uuid,
      }),
      beforeHandle: Auth.access({ scope: ApiKeyScope.x402 }),
      detail: {
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
      detail: {
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
      body: PaymentBody,
      beforeHandle: Auth.access({ scope: ApiKeyScope.x402 }),
      detail: {
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
      body: PaymentBody,
      beforeHandle: Auth.access({ scope: ApiKeyScope.x402 }),
      detail: {
        tags: ["x402"],
        summary: "Settle an x402 payment",
      },
    },
  );
