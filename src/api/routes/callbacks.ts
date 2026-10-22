import {
  getProvider,
  isProviderConfiguredForAction,
} from "../../shared/providers";
import { Provider, ProviderAction } from "../../shared/constants";
import { type OnchainNotifier } from "../../sdks/interfaces/OnchainNotifier";
import { TransferService } from "../../services/Transfer.service";
import { gunzipSync } from "node:zlib";
import { KvService } from "../../services/Kv.service";
import { HttpError } from "../../shared/errors";
import { readBody } from "../middlewares/readBody";
import { common } from "../../shared/common";
import { Elysia } from "elysia";
import { t } from "../schema";

const MaxCallbackBytes = 25 * 1024 * 1024;

const isGzip = (bytes: Buffer) => {
  return bytes[0] === 0x1f && bytes[1] === 0x8b;
};

export const callbackRoutes = new Elysia({ name: "CallbackRoute" }).post(
  "/callback/:provider/:activity",
  async ({ request, params }) => {
    const options = {
      variables: await new KvService().getSdkOptionVariables(),
    };

    isProviderConfiguredForAction(
      params.provider,
      ProviderAction.OnchainNotifier,
      options,
    );

    const received = await readBody(request, MaxCallbackBytes);

    let bytes = received;

    if (isGzip(received)) {
      try {
        bytes = gunzipSync(received, {
          maxOutputLength: 2 * MaxCallbackBytes,
        });
      } catch {
        throw new HttpError(
          413,
          "PayloadTooLarge",
          "Body is too large or not valid gzip",
        );
      }
    }

    const rawBody = bytes.toString("utf8");

    const body = common.toJson(rawBody, () => {
      throw new HttpError(400, "BadRequest", "Body is not valid JSON");
    });

    let isValid = false;

    const notifier = getProvider<OnchainNotifier>(params.provider);

    try {
      isValid = await notifier.isValidCallback(
        { body, headers: Object.fromEntries(request.headers), rawBody },
        options,
      );
    } catch {
      // do nothing
    }

    if (!isValid) {
      throw new HttpError(401, "Unauthorized", "Invalid request");
    }

    const items = await notifier.handleCallback(params.activity, body!);
    if (items && items.length)
      await new TransferService().handleOnchainNotifierCallback(items);

    return { items: items?.length ?? 0 };
  },
  {
    params: t.Object({
      provider: t.Enum(Provider),
      activity: t.Union([
        t.Literal("addressActivity"),
        t.Literal("contractEvent"),
      ]),
    }),
    parse: "none",
    detail: {
      hide: true,
    },
  },
);
