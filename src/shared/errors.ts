import { KeyVars, type Provider } from "./constants";
import { type AppSchema } from "../db/schema";

export class AppError extends Error {
  constructor(message: string) {
    super(message);

    this.name = "AppError";
  }
}

type Resource = keyof AppSchema;

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
