import { handleError } from "./middlewares/errorHandller";
import { HttpError } from "../shared/errors";
import { version } from "../../package.json";
import { openapi } from "@elysiajs/openapi";
import { common } from "../shared/common";
import { Elysia } from "elysia";
import { node } from "@elysiajs/node";
import { env } from "../shared/env";

// routes
import { paymentLinkRoutes } from "./routes/paymentLinks";
import { dashboardRoutes } from "./routes/dashboard";
import { priceFeedRoutes } from "./routes/priceFeeds";
import { callbackRoutes } from "./routes/callbacks";
import { customerRoutes } from "./routes/customers";
import { overviewRoutes } from "./routes/overview";
import { transferRoutes } from "./routes/transfers";
import { checkoutRoutes } from "./routes/checkout";
import { webhookRoutes } from "./routes/webhooks";
import { apiKeyRoutes } from "./routes/apiKeys";
import { quoteRoutes } from "./routes/quotes";
import { tokenRoutes } from "./routes/tokens";
import { chainRoutes } from "./routes/chains";
import { x402Routes } from "./routes/x402";
import { feeRoutes } from "./routes/fees";
import { appRoutes } from "./routes/app";
import { kvRoutes } from "./routes/kv";

const api = new Elysia({ prefix: "/api" })
  .use(appRoutes)
  .use(apiKeyRoutes)
  .use(chainRoutes)
  .use(tokenRoutes)
  .use(checkoutRoutes)
  .use(customerRoutes)
  .use(feeRoutes)
  .use(kvRoutes)
  .use(overviewRoutes)
  .use(paymentLinkRoutes)
  .use(priceFeedRoutes)
  .use(quoteRoutes)
  .use(transferRoutes)
  .use(webhookRoutes)
  .use(x402Routes);

export const createApp = () => {
  const app = new Elysia({ adapter: node(), normalize: false })
    .onRequest(({ request, set }) => {
      const url = new URL(request.url);
      if (!url.pathname.startsWith("/api")) {
        return;
      }

      const headers = {
        "access-control-allow-origin": "*",
        "access-control-max-age": "600",
        "access-control-allow-methods":
          "GET, POST, PUT, PATCH, DELETE, OPTIONS",
        "access-control-allow-headers":
          "content-type, x-kite-root-key, x-kite-api-key-id, x-kite-signature, x-kite-timestamp, x-kite-nonce, x-kite-public-key, x-kite-app-id",
      };

      Object.assign(set.headers, headers);

      if (request.method === "OPTIONS") {
        return new Response(null, {
          status: 204,
          headers,
        });
      }
    })
    .onError({ as: "global" }, ({ code, error, set }) => {
      const cause =
        code === "PARSE" && error instanceof Error ? error.cause : undefined;

      const http =
        handleError(cause instanceof HttpError ? cause : error) ??
        (code === "VALIDATION" && error.type !== "response"
          ? new HttpError(422, "ValidationError", error.message)
          : code === "NOT_FOUND"
            ? new HttpError(404, "NotFound", "Route not found")
            : code === "PARSE"
              ? new HttpError(400, "BadRequest", "Malformed request body")
              : null);

      if (!http) {
        console.error(error);

        set.status = 500;

        return {
          error: {
            code: "InternalError",
            message: "Internal server error",
          },
        };
      }

      set.status = http.status;

      return {
        error: {
          code: http.code,
          message: http.message,
        },
      };
    })
    .onAfterHandle({ as: "global" }, ({ response }) => {
      if (
        response &&
        typeof response === "object" &&
        !(response instanceof Response)
      ) {
        return common.serializeData(response);
      }
    });

  if (env.KITE_ENABLE_OPENAPI_UI_SPECS) {
    app.use(
      openapi({
        provider:
          env.KITE_ENABLE_OPENAPI_UI_PROVIDER === "swagger"
            ? "swagger-ui"
            : "scalar",
        documentation: {
          info: {
            title: "Kite",
            version,
          },
          components: {
            securitySchemes: {
              signature: {
                type: "apiKey",
                in: "header",
                name: "x-kite-signature",
                description:
                  "Base64url Ed25519 signature of `timestamp\nnonce\nMETHOD\npath?query\nsha256(body)`, sent with x-kite-api-key-id, x-kite-timestamp and x-kite-nonce",
              },
              rootKey: {
                type: "apiKey",
                in: "header",
                name: "x-kite-root-key",
                description:
                  "The server's root key. Grants access to every endpoint; add x-kite-app-id to act as one app",
              },
              publicKey: {
                type: "apiKey",
                in: "header",
                name: "x-kite-public-key",
                description:
                  "The API key's public key, sent with x-kite-api-key-id, for endpoints that allow it",
              },
            },
          },
        },
      }),
    );
  }

  app.use(callbackRoutes).use(api);

  if (env.KITE_ENABLE_DASHBOARD) {
    app.use(dashboardRoutes);
  }

  return app;
};
