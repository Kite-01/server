import { KeyVars, ProviderAction, type Provider } from "./constants";
import type * as schema from "../db/schema";

export class UnsafeUrlError extends Error {
  public readonly url?: string;

  constructor(message: string, url?: string) {
    super(message);
    this.name = "UnsafeUrlError";
    this.url = url;
  }
}

export class JsonRpcCallError extends Error {
  public readonly provider: Provider;
  public readonly code: number;
  public readonly data?: unknown;

  constructor(provider: Provider, method: string, error?: JsonRpcError) {
    super(
      `${provider}: ${method} failed (${error?.code ?? "no code"}) ${error?.message ?? ""}`.trim(),
    );

    this.name = "JsonRpcCallError";
    this.provider = provider;
    this.code = error?.code ?? -32603;
    this.data = error?.data;
  }
}

export class AppError extends Error {
  constructor(message: string) {
    super(message);

    this.name = "AppError";
  }
}

type Resource = keyof typeof schema;

export class NotFoundError extends Error {
  public readonly resource: Resource;
  public readonly resourceId: string;

  constructor(
    resource: Resource,
    resourceId: string,
    message = "Resource not found",
  ) {
    super(message);

    this.name = "NotFoundError";
    this.resource = resource;
    this.resourceId = resourceId;
  }
}

export class PreconditionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PreconditionError";
  }
}

export class QuoteExpiredError extends Error {
  public readonly quoteId: string;

  constructor(quoteId: string) {
    super("Quote has expired");
    this.name = "QuoteExpiredError";
    this.quoteId = quoteId;
  }
}

export class ChainNotConfiguredForx402Error extends Error {
  public readonly caip2Id: Caip2Id;

  constructor(caip2Id: Caip2Id) {
    super(`${caip2Id} is not configured to process x402 payments`);
    this.name = "ChainNotConfiguredForx402Error";
    this.caip2Id = caip2Id;
  }
}

export class ChainNotSupportedByProviderError extends Error {
  public readonly provider: Provider;
  public readonly internalChainId: Caip2Id;

  constructor(internalChainId: Caip2Id, provider: Provider) {
    super(`${provider} does not support "${internalChainId}"`);
    this.name = "ChainNotSupportedByProviderError";
    this.internalChainId = internalChainId;
    this.provider = provider;
  }
}

export class ChainNotSupportedError extends Error {
  public readonly internalChainId: Caip2Id;

  constructor(internalChainId: Caip2Id) {
    super(`"${internalChainId}" is not supported at the moment`);
    this.name = "ChainNotSupportedError";
    this.internalChainId = internalChainId;
  }
}

export class ProviderNotConfiguredForActionError extends Error {
  public readonly provider: Provider;
  public readonly action: ProviderAction;

  constructor(provider: Provider, action: ProviderAction) {
    super(`${provider} cannot act as a/an "${action}"`);
    this.name = "ProviderNotConfiguredForActionError";
    this.provider = provider;
    this.action = action;
  }
}

export class ProviderYetToBeConfiguredError extends Error {
  public readonly provider: Provider;
  public readonly action: ProviderAction;

  constructor(provider: Provider, action: ProviderAction) {
    super(`${provider} is yet to be configured as a/an "${action}"`);
    this.name = "ProviderYetToBeConfiguredError";
    this.provider = provider;
    this.action = action;
  }
}

export class SdkConfigError extends Error {
  public readonly keyVar: KeyVars;

  constructor(keyVar: KeyVars) {
    super(`"${keyVar}" is not configured`);
    this.name = "SdkConfigError";
    this.keyVar = keyVar;
  }
}

export class SdkRequestError extends Error {
  public readonly provider: Provider;
  public readonly action: string;
  public readonly statusCode?: number;
  public readonly body?: unknown;

  constructor(
    provider: Provider,
    action: string,
    response: HttpResponse,
    message?: string,
  ) {
    super(message ?? `${provider} Sdk Request Error`);

    this.name = "SdkRequestError";
    this.provider = provider;
    this.action = action;
    this.statusCode = response.statusCode;
    this.body = response.data;
  }
}
