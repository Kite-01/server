import { Digits, EvmAddress, UuidIdParams, PageQuery, Uuid } from "../schema";
import { QuoteService } from "../../services/Quote.service";
import { ApiKeyScope } from "../../shared/constants";
import { HttpError } from "../../shared/errors";
import { models } from "../models";
import { Elysia } from "elysia";
import { Scope } from "../middlewares/scope";
import { Auth } from "../middlewares/auth";
import { t } from "../schema";

const quoteService = new QuoteService();

export const quoteRoutes = new Elysia({ name: "QuotesRoute" })
  .use(Auth.plugin)
  .use(models)
  .post(
    "/quotes",
    async ({ actor, body, set }) => {
      const created = await quoteService.createQuote(Auth.requireAppId(actor), {
        ...body,
        amount: BigInt(body.amount),
      });

      set.status = 201;
      return created;
    },
    {
      parse: "json",
      body: t.Object({
        chainId: Uuid,
        sourceTokenAddress: EvmAddress,
        amount: Digits,
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
      beforeHandle: Auth.access({ scope: ApiKeyScope.QuoteWrite }),
      detail: {
        operationId: "quotes.create",
        tags: ["Quotes"],
        summary: "Quote a payment of an exact amount in a token",
      },
    },
  )
  .get(
    "/quotes",
    ({ actor, query }) => {
      return quoteService.getQuotes({
        ...query,
        appId: actor.appId,
      });
    },
    {
      query: t.Object({
        customerId: t.Optional(Uuid),
        paymentLinkId: t.Optional(Uuid),
        q: t.Optional(t.String({ maxLength: 100 })),
        ...PageQuery,
      }),
      response: {
        200: "QuotePage",
      },
      beforeHandle: Auth.access({ scope: ApiKeyScope.QuoteRead }),
      detail: {
        operationId: "quotes.list",
        tags: ["Quotes"],
        summary: "List quotes",
      },
    },
  )
  .get(
    "/quotes/:id",
    async ({ actor, params }) => {
      const appId = await Scope.appFor(actor, "quote", params.id);
      const quote = await quoteService.getQuote(appId, params.id);

      if (!quote) throw new HttpError(404, "NotFound", "Quote not found");
      return quote;
    },
    {
      params: UuidIdParams,
      response: {
        200: "QuoteDetails",
      },
      beforeHandle: Auth.access({ scope: ApiKeyScope.QuoteRead }),
      detail: {
        operationId: "quotes.get",
        tags: ["Quotes"],
        summary: "Get a quote",
      },
    },
  );
