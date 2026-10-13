import { EvmAddress, UuidIdParams, PageQuery, Uuid } from "../schema";
import { ApiKeyScope, TransferStatus } from "../../shared/constants";
import { TransferService } from "../../services/Transfer.service";
import { QuoteService } from "../../services/Quote.service";
import { HttpError } from "../../shared/errors";
import { models } from "../models";
import { Elysia } from "elysia";
import { Scope } from "../middlewares/scope";
import { Auth } from "../middlewares/auth";
import { t } from "../schema";

const transferService = new TransferService();
const quoteService = new QuoteService();

export const transferRoutes = new Elysia({ name: "TransfersRoute" })
  .use(Auth.plugin)
  .use(models)
  .post(
    "/transfers",
    async ({ actor, body, set }) => {
      const appId = Auth.requireAppId(actor);

      if (actor.kind === "app" && actor.via === "publicKey") {
        const quote = await quoteService.getQuote(appId, body.quoteId);
        if (!quote?.paymentLinkId) {
          throw new HttpError(
            401,
            "Unauthorized",
            "Only quotes created from a payment link can be used without a signature",
          );
        }
      }

      const created = await transferService.createTransfer(
        appId,
        body.quoteId,
        body.refundAddress,
      );

      set.status = 201;
      return created;
    },
    {
      parse: "json",
      body: t.Object({
        quoteId: Uuid,
        refundAddress: EvmAddress,
      }),
      response: {
        201: "CreatedTransfer",
      },
      beforeHandle: Auth.access({
        scope: ApiKeyScope.TransferWrite,
        public: true,
      }),
      detail: {
        tags: ["Transfers"],
        summary: "Create transfer for a quote",
      },
    },
  )
  .get(
    "/transfers",
    ({ actor, query }) => {
      return transferService.getTransfers({
        ...query,
        appId: actor.appId,
      });
    },
    {
      query: t.Object({
        status: t.Optional(t.Enum(TransferStatus)),
        q: t.Optional(t.String({ maxLength: 100 })),
        ...PageQuery,
      }),
      response: {
        200: "TransferPage",
      },
      beforeHandle: Auth.access({ scope: ApiKeyScope.TransferRead }),
      detail: {
        tags: ["Transfers"],
        summary: "List transfers",
      },
    },
  )
  .get(
    "/transfers/:id",
    async ({ actor, params }) => {
      const appId = await Scope.appFor(actor, "transfer", params.id);
      const transfer = await transferService.getTransfer(appId, params.id);

      if (!transfer) throw new HttpError(404, "NotFound", "Transfer not found");
      return transfer;
    },
    {
      params: UuidIdParams,
      response: {
        200: "TransferDetails",
      },
      beforeHandle: Auth.access({
        scope: ApiKeyScope.TransferRead,
        public: true,
      }),
      detail: {
        tags: ["Transfers"],
        summary: "Get a transfer",
      },
    },
  );
