import { ApiKeyScope, WebhookCategory } from "../../shared/constants";
import { UuidIdParams, PageQuery } from "../schema";
import { WebhookService } from "../../services/Webhook.service";
import { HttpError } from "../../shared/errors";
import { Elysia } from "elysia";
import { Scope } from "../middlewares/scope";
import { Auth } from "../middlewares/auth";
import { t } from "../schema";

const webhookService = new WebhookService();

const withoutSigningKey = <T extends { signingKey: string }>({
  signingKey: _signingKey,
  ...rest
}: T) => rest;

export const webhookRoutes = new Elysia({ name: "WebhooksRoute" })
  .use(Auth.plugin)
  .post(
    "/webhooks",
    async ({ actor, body, set }) => {
      const created = await webhookService.createWebhook({
        ...body,
        appId: Auth.requireAppId(actor),
      });

      set.status = 201;
      return created;
    },
    {
      body: t.Object({
        url: t.String({
          format: "uri",
          pattern: "^https?://",
          maxLength: 2048,
        }),
        label: t.String({
          minLength: 1,
          maxLength: 120,
        }),
        categories: t.Array(t.Enum(WebhookCategory), {
          minItems: 1,
          uniqueItems: true,
        }),
        maxRetries: t.Optional(
          t.Integer({
            minimum: 0,
            maximum: 20,
          }),
        ),
        retryIntervalInSeconds: t.Optional(
          t.Integer({
            minimum: 1,
            maximum: 86400,
          }),
        ),
        timeoutInSeconds: t.Optional(
          t.Integer({
            minimum: 1,
            maximum: 120,
          }),
        ),
      }),
      beforeHandle: Auth.access({ scope: ApiKeyScope.WebhookWrite }),
      detail: {
        tags: ["Webhooks"],
        summary: "Create a webhook",
      },
    },
  )
  .get(
    "/webhooks",
    async ({ actor, query }) => {
      const page = await webhookService.getWebhooks({
        ...query,
        appId: actor.appId,
      });

      return {
        ...page,
        data: page.data.map(withoutSigningKey),
      };
    },
    {
      query: t.Object({
        q: t.Optional(t.String({ maxLength: 100 })),
        ...PageQuery,
      }),
      beforeHandle: Auth.access({ scope: ApiKeyScope.WebhookRead }),
      detail: {
        tags: ["Webhooks"],
        summary: "List webhooks",
      },
    },
  )
  .get(
    "/webhooks/:id/deliveries",
    async ({ actor, params, query }) => {
      const appId = await Scope.appFor(actor, "webhook", params.id);
      const deliveries = await webhookService.getWebhookDeliveries(
        appId,
        params.id,
        query,
      );

      return deliveries;
    },
    {
      params: UuidIdParams,
      query: t.Object(PageQuery),
      beforeHandle: Auth.access({ scope: ApiKeyScope.WebhookRead }),
      detail: {
        tags: ["Webhooks"],
        summary: "List a webhook's delivery attempts",
      },
    },
  )
  .delete(
    "/webhooks/:id",
    async ({ actor, params }) => {
      const appId = await Scope.appFor(actor, "webhook", params.id);
      const webhook = await webhookService.deleteWebhook(appId, params.id);

      if (!webhook) throw new HttpError(404, "NotFound", "Webhook not found");
      return withoutSigningKey(webhook);
    },
    {
      params: UuidIdParams,
      beforeHandle: Auth.access({ scope: ApiKeyScope.WebhookDelete }),
      detail: {
        tags: ["Webhooks"],
        summary: "Delete a webhook",
      },
    },
  );
