import { EvmAddress, UuidIdParams, PageQuery, Uuid } from "../schema";
import { ApiKeyScope, TransferStatus } from "../../shared/constants";
import { TransferService } from "../../services/Transfer.service";
import { HttpError } from "../../shared/errors";
import { models } from "../models";
import { Elysia } from "elysia";
import { Scope } from "../middlewares/scope";
import { Auth } from "../middlewares/auth";
import { t } from "../schema";

const transferService = new TransferService();

export const transferRoutes = new Elysia({ name: "TransfersRoute" })
  .use(Auth.plugin)
  .use(models)
  .post(
    "/transfers",
    async ({ actor, body, set }) => {
      const created = await transferService.createTransfer(
        Auth.requireAppId(actor),
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
      beforeHandle: Auth.access({ scope: ApiKeyScope.TransferWrite }),
      detail: {
        operationId: "transfers.create",
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
        operationId: "transfers.list",
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
      beforeHandle: Auth.access({ scope: ApiKeyScope.TransferRead }),
      detail: {
        operationId: "transfers.get",
        tags: ["Transfers"],
        summary: "Get a transfer",
      },
    },
  )
  .post(
    "/transfers/:id/refund",
    async ({ actor, params, body }) => {
      await Scope.appFor(actor, "transfer", params.id);
      const result = await transferService.refundTransfer(
        params.id,
        body.useGasSponsor ?? true,
      );

      if (!result.refunded)
        throw new HttpError(409, "PreconditionFailed", result.reason);

      return {};
    },
    {
      parse: "json",
      params: UuidIdParams,
      body: t.Object({ useGasSponsor: t.Optional(t.Boolean()) }),
      response: { 200: t.Object({}) },
      beforeHandle: Auth.access({ scope: ApiKeyScope.TransferWrite }),
      detail: {
        operationId: "transfers.refund",
        tags: ["Transfers"],
        summary: "Refund a transfer",
      },
    },
  )
  .post(
    "/transfers/:id/recover/balance",
    async ({ actor, params, body }) => {
      await Scope.appFor(actor, "transfer", params.id);
      const balance = await transferService.getRecoveryBalance(
        params.id,
        body.tokenAddress,
      );
      return { balance: balance.toString() };
    },
    {
      parse: "json",
      params: UuidIdParams,
      body: t.Object({ tokenAddress: EvmAddress }),
      response: { 200: t.Object({ balance: t.String() }) },
      beforeHandle: Auth.access({ scope: ApiKeyScope.TransferWrite }),
      detail: {
        operationId: "transfers.recoverBalance",
        tags: ["Transfers"],
        summary: "Check a transfer pay-in token balance",
      },
    },
  )
  .post(
    "/transfers/:id/recover",
    async ({ actor, params, body }) => {
      await Scope.appFor(actor, "transfer", params.id);
      await transferService.recover(
        params.id,
        body.tokenAddress,
        body.destinationAddress,
        body.useGasSponsor ?? true,
      );
      return {};
    },
    {
      parse: "json",
      params: UuidIdParams,
      body: t.Object({
        tokenAddress: EvmAddress,
        destinationAddress: EvmAddress,
        useGasSponsor: t.Optional(t.Boolean()),
      }),
      response: { 200: t.Object({}) },
      beforeHandle: Auth.access({ scope: ApiKeyScope.TransferWrite }),
      detail: {
        operationId: "transfers.recover",
        tags: ["Transfers"],
        summary: "Recover transfer tokens",
      },
    },
  );
