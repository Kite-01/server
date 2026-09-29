import { type Provider } from "../shared/constants";
import { Http } from "./Http";

/**
 * Thin JSON-RPC layer over `Http`.
 *
 * Both paymaster APIs are JSON-RPC, not REST, and a JSON-RPC error arrives as
 * **HTTP 200 with an `error` member** — so `is_ok` alone will happily report
 * success on a rejected sponsorship. Everything goes through `call`, which folds
 * the RPC error into the same `is_ok` convention the REST SDKs use.
 */
export type JsonRpcError = {
  code: number;
  message: string;
  data?: unknown;
};

export type JsonRpcResult<T> = {
  is_ok: boolean;
  data?: T;
  error?: JsonRpcError;
  status_code?: number;
};

type JsonRpcEnvelope<T> = {
  jsonrpc: "2.0";
  id: number | string;
  result?: T;
  error?: JsonRpcError;
};

export class JsonRpc {
  private readonly http: Http;
  private readonly provider: Provider;
  private id = 0;

  constructor(url: string, provider: Provider) {
    this.provider = provider;
    this.http = new Http(url, {
      "Content-Type": "application/json",
      Accept: "application/json",
    });
  }

  call = async <T>(method: string, params: unknown[]): Promise<JsonRpcResult<T>> => {
    this.id += 1;

    const response = await this.http.post<JsonRpcEnvelope<T>>("", {
      jsonrpc: "2.0",
      id: this.id,
      method,
      params,
    });

    if (!response.is_ok) {
      return {
        is_ok: false,
        status_code: response.status_code,
        error: extractError(response.data),
      };
    }

    const envelope = response.data;

    if (envelope?.error) {
      return {
        is_ok: false,
        status_code: response.status_code,
        error: envelope.error,
      };
    }

    if (envelope?.result === undefined) {
      return {
        is_ok: false,
        status_code: response.status_code,
        error: {
          code: -32603,
          message: `${this.provider}: ${method} returned neither result nor error`,
        },
      };
    }

    return { is_ok: true, data: envelope.result, status_code: response.status_code };
  };
}

const extractError = (data: unknown): JsonRpcError => {
  const candidate = (data as JsonRpcEnvelope<unknown> | undefined)?.error;
  if (candidate?.message) return candidate;

  return { code: -32603, message: "transport error", data };
};

export class JsonRpcCallError extends Error {
  public readonly code: number;
  public readonly data?: unknown;

  constructor(provider: Provider, method: string, error?: JsonRpcError) {
    super(
      `${provider}: ${method} failed (${error?.code ?? "no code"}) ${error?.message ?? ""}`.trim(),
    );
    this.name = "JsonRpcCallError";
    this.code = error?.code ?? -32603;
    this.data = error?.data;
  }
}

/** Unwrap a call, throwing a descriptive error instead of returning undefined. */
export const unwrap = <T>(
  provider: Provider,
  method: string,
  result: JsonRpcResult<T>,
): T => {
  if (!result.is_ok || result.data === undefined) {
    throw new JsonRpcCallError(provider, method, result.error);
  }
  return result.data;
};
