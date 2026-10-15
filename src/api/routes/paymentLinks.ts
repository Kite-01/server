import { EvmAddress, UuidIdParams, PageQuery, Uuid } from "../schema";
import { formatUnits, parseUnits } from "viem";
import { Elysia, type Static } from "elysia";
import { PaymentLinkService } from "../../services/PaymentLink.service";
import { PriceFeedService } from "../../services/PriceFeed.service";
import { QuoteService } from "../../services/Quote.service";
import { ApiKeyScope } from "../../shared/constants";
import { HttpError } from "../../shared/errors";
import { models } from "../models";
import { Scope } from "../middlewares/scope";
import { Auth } from "../middlewares/auth";
import { t } from "../schema";

const paymentLinkService = new PaymentLinkService();
const priceFeedService = new PriceFeedService();
const quoteService = new QuoteService();

const assertSupportedCurrency = async (currency?: string) => {
  if (currency === undefined) return;
  if (!(await priceFeedService.isSupportedCurrency(currency))) {
    throw new HttpError(
      422,
      "ValidationError",
      `${currency.toUpperCase()} is not a supported currency`,
    );
  }
};

const Amount = t.String({
  pattern: "^(?:0|[1-9][0-9]{0,19})(?:\\.[0-9]{1,18})?$",
});

const LineItems = t.Array(
  t.Object({
    image: t.Optional(t.Union([t.String({ format: "uri" }), t.Null()])),
    name: t.String({
      minLength: 1,
      maxLength: 200,
    }),
    price: Amount,
    quantity: t.Number({
      minimum: 1,
    }),
  }),
);

// Prices and quantities carry up to 18 decimals each, so totals are compared
// exactly at 36.
const assertLineItemsTotal = (
  amount: string,
  lineItems: Static<typeof LineItems> | null | undefined,
) => {
  if (!lineItems?.length) return;

  const total = lineItems.reduce(
    (sum, item) =>
      sum + parseUnits(item.price, 18) * parseUnits(String(item.quantity), 18),
    0n,
  );

  if (total !== parseUnits(amount, 36)) {
    throw new HttpError(
      422,
      "ValidationError",
      `Line items add up to ${formatUnits(total, 36)}, but the amount is ${formatUnits(parseUnits(amount, 36), 36)}`,
    );
  }
};

const Fields = {
  title: t.String({
    minLength: 1,
    maxLength: 200,
  }),
  currency: t.String({
    minLength: 2,
    maxLength: 10,
  }),
  amount: Amount,
  lineItems: t.Optional(LineItems),
};

export const paymentLinkRoutes = new Elysia({ name: "PaymentLinksRoute" })
  .use(Auth.plugin)
  .use(models)
  .get(
    "/payment-links/currencies",
    async () => ({
      data: await priceFeedService.getSupportedCurrencies(),
    }),
    {
      response: {
        200: t.Object({
          data: t.Array(t.String()),
        }),
      },
      beforeHandle: Auth.access({
        scope: ApiKeyScope.PaymentLinkRead,
        public: true,
      }),
      detail: {
        tags: ["Payment links"],
        summary: "Currencies a payment link can be priced in",
      },
    },
  )
  .post(
    "/payment-links",
    async ({ actor, body, set }) => {
      await assertSupportedCurrency(body.currency);
      assertLineItemsTotal(body.amount, body.lineItems);
      const created = await paymentLinkService.createPaymentLink({
        ...body,
        currency: body.currency.toUpperCase(),
        appId: Auth.requireAppId(actor),
      });

      set.status = 201;
      return created;
    },
    {
      parse: "json",
      body: t.Object(Fields),
      response: {
        201: "PaymentLink",
      },
      beforeHandle: Auth.access({ scope: ApiKeyScope.PaymentLinkWrite }),
      detail: {
        tags: ["Payment links"],
        summary: "Create a payment link",
      },
    },
  )
  .get(
    "/payment-links",
    ({ actor, query }) => {
      return paymentLinkService.getPaymentLinks({
        ...query,
        appId: actor.appId,
      });
    },
    {
      query: t.Object({
        q: t.Optional(t.String({ maxLength: 100 })),
        ...PageQuery,
      }),
      response: {
        200: "PaymentLinkPage",
      },
      beforeHandle: Auth.access({ scope: ApiKeyScope.PaymentLinkRead }),
      detail: {
        tags: ["Payment links"],
        summary: "List payment links",
      },
    },
  )
  .get(
    "/payment-links/:id",
    async ({ actor, params }) => {
      const appId = await Scope.appFor(actor, "paymentLink", params.id);
      const link = await paymentLinkService.getPaymentLink(appId, params.id);

      if (!link) throw new HttpError(404, "NotFound", "Payment link not found");
      return link;
    },
    {
      params: UuidIdParams,
      response: {
        200: "PaymentLink",
      },
      beforeHandle: Auth.access({
        scope: ApiKeyScope.PaymentLinkRead,
        public: true,
      }),
      detail: {
        tags: ["Payment links"],
        summary: "Get a payment link",
      },
    },
  )
  .patch(
    "/payment-links/:id",
    async ({ actor, params, body }) => {
      const appId = await Scope.appFor(actor, "paymentLink", params.id);
      await assertSupportedCurrency(body.currency);

      if (body.amount !== undefined || body.lineItems !== undefined) {
        const current = await paymentLinkService.getPaymentLink(
          appId,
          params.id,
        );
        if (!current) {
          throw new HttpError(404, "NotFound", "Payment link not found");
        }

        assertLineItemsTotal(
          body.amount ?? current.amount,
          body.lineItems ??
            (current.lineItems as Static<typeof LineItems> | null),
        );
      }

      const link = await paymentLinkService.updatePaymentLink(
        appId,
        params.id,
        { ...body, currency: body.currency?.toUpperCase() },
      );

      if (!link) throw new HttpError(404, "NotFound", "Payment link not found");
      return link;
    },
    {
      params: UuidIdParams,
      parse: "json",
      body: t.Partial(t.Object(Fields)),
      response: {
        200: "PaymentLink",
      },
      beforeHandle: Auth.access({ scope: ApiKeyScope.PaymentLinkWrite }),
      detail: {
        tags: ["Payment links"],
        summary: "Update a payment link",
      },
    },
  )
  .delete(
    "/payment-links/:id",
    async ({ actor, params }) => {
      const appId = await Scope.appFor(actor, "paymentLink", params.id);
      const link = await paymentLinkService.deletePaymentLink(appId, params.id);

      if (!link) throw new HttpError(404, "NotFound", "Payment link not found");
      return link;
    },
    {
      params: UuidIdParams,
      response: {
        200: "PaymentLink",
      },
      beforeHandle: Auth.access({ scope: ApiKeyScope.PaymentLinkDelete }),
      detail: {
        tags: ["Payment links"],
        summary: "Delete a payment link",
      },
    },
  )
  .post(
    "/payment-links/:id/pay",
    async ({ actor, params, body, set }) => {
      const appId = await Scope.appFor(actor, "paymentLink", params.id);
      const created = await quoteService.createQuoteFromPaymentLink(
        appId,
        params.id,
        body,
      );

      set.status = 201;
      return created;
    },
    {
      params: UuidIdParams,
      parse: "json",
      body: t.Object({
        chainId: Uuid,
        sourceTokenAddress: EvmAddress,
        customerId: t.Optional(Uuid),
        reference: t.Optional(
          t.String({
            minLength: 1,
            maxLength: 255,
          }),
        ),
        meta: t.Optional(t.Record(t.String(), t.Unknown())),
      }),
      response: {
        201: "Quote",
      },
      beforeHandle: Auth.access({
        scope: ApiKeyScope.QuoteWrite,
        public: true,
      }),
      detail: {
        tags: ["Payment links"],
        summary: "Create a quote for a payment link",
      },
    },
  );
