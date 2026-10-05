import { JsonRpcCallError } from "../shared/errors";
import { type Provider } from "../shared/constants";
import { Http } from "./Http";

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

  static unwrap = <T>(
    provider: Provider,
    method: string,
    result: JsonRpcResult<T>,
  ): T => {
    if (!result.isOk || result.data === undefined) {
      throw new JsonRpcCallError(provider, method, result.error);
    }

    return result.data;
  };

  call = async <T>(
    method: string,
    params: unknown[],
  ): Promise<JsonRpcResult<T>> => {
    this.id += 1;

    const response = await this.http.post<JsonRpcEnvelope<T>>("", {
      jsonrpc: "2.0",
      id: this.id,
      method,
      params,
    });

    const envelope = response.data;
    const statusCode = response.statusCode;

    if (!response.isOk) {
      const candidate = envelope?.error;
      const error = candidate?.message
        ? candidate
        : { code: -32603, message: "transport error", data: envelope };

      return {
        isOk: false,
        statusCode,
        error,
      };
    }

    if (envelope?.error) {
      return {
        isOk: false,
        statusCode,
        error: envelope.error,
      };
    }

    if (envelope?.result === undefined) {
      return {
        isOk: false,
        statusCode,
        error: {
          code: -32603,
          message: `${this.provider}: ${method} returned neither result nor error`,
        },
      };
    }

    return {
      isOk: true,
      data: envelope.result,
      statusCode,
    };
  };
}
