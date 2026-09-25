import { type OnchainNotifier } from "./interfaces/OnchainNotifier";
import { type BaseSdk } from "./interfaces/BaseSdk";
import { createHmac } from "node:crypto";
import { KeyVars } from "../shared/constants";
import { Http } from "./Http";
import { get } from "lodash";

export class Alchemy implements OnchainNotifier, BaseSdk {
  getClient = (options: SdkOptions): Http => {
    const alchemyToken = get(options.variables, KeyVars.AlchemyToken, null);
    if (!alchemyToken) throw new Error("");

    const client = new Http("https://api.alchemy.com", {
      "X-Alchemy-Token": alchemyToken,
      "Content-Type": "application/json",
      Accept: "application/json",
    });

    return client;
  };

  track = async (
    input: OnchainNotifierTrackInput,
    options: SdkOptions,
  ): Promise<OnchainNotifierTrackResult> => {
    const client = this.getClient(options);

    client.post("/");

    // correlationId is the identifier on the provider side so it can be untracked when needed
    const correlationId = "";

    return { correlationId };
  };

  trackEvent = async (
    input: OnchainNotifierTrackEventInput,
    options: SdkOptions,
  ): Promise<OnchainNotifierTrackResult> => {
    const correlationId = "";

    return { correlationId };
  };

  untrack = async (
    correlationId: string,
    options: SdkOptions,
  ): Promise<void> => {};

  isValidCallback = (
    input: OnchainNotifierVerifyCallbackInput,
    options: SdkOptions,
  ): boolean => {
    // x-alchemy-signature
    const alchemySignature = get(input.headers, "x-alchemy-signature", null);
    if (!alchemySignature) throw new Error("");

    const signingKey = get(options.variables, KeyVars.AlchemySigningKey, null);
    if (!signingKey) throw new Error("");

    const digest = createHmac("sha256", signingKey)
      .update(JSON.stringify(input.body), "utf8")
      .digest("hex");

    return alchemySignature === digest;
  };

  handleCallback = async (
    payload: Record<string, unknown>,
  ): Promise<OnchainNotifierCallbackResult> => {
    return {};
  };
}
