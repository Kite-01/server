import { createPrivateKey, randomBytes, sign } from "node:crypto";
import { createApp } from "../api/app";
import { signing } from "../shared/signing";
import { rootKey } from "./rootKey";

export const app = createApp();

export type Credentials = {
  keyId: string;
  privateKey: string;
  appId?: string;
};

export const rootCredentials = (appId?: string): Credentials => ({
  keyId: "root",
  privateKey: rootKey,
  appId,
});

type CallOptions = {
  body?: unknown;
  query?: Record<string, string | number>;
  headers?: Record<string, string>;
  timestamp?: number;
  nonce?: string;
};

const target = (path: string, query?: CallOptions["query"]) => {
  if (!query) {
    return path;
  }

  const search = new URLSearchParams(
    Object.entries(query).map(([k, v]) => [k, String(v)]),
  ).toString();
  return search ? `${path}?${search}` : path;
};

export const signedHeaders = (
  credentials: Credentials,
  method: string,
  path: string,
  options: CallOptions = {},
) => {
  const raw = options.body === undefined ? "" : JSON.stringify(options.body);

  if (credentials.keyId === "root") {
    return {
      "x-kite-root-key": credentials.privateKey,
      ...(credentials.appId ? { "x-kite-app-id": credentials.appId } : {}),
      ...(options.body === undefined
        ? {}
        : { "content-type": "application/json" }),
      ...options.headers,
    } as Record<string, string>;
  }

  const timestamp = String(options.timestamp ?? Math.floor(Date.now() / 1000));
  const nonce = options.nonce ?? randomBytes(16).toString("hex");

  const signed = {
    timestamp,
    nonce,
    method,
    target: target(path, options.query),
    body: raw,
  };

  const signature = sign(
    null,
    Buffer.from(signing.signingString(signed)),
    createPrivateKey({
      key: Buffer.from(credentials.privateKey, "base64url"),
      format: "der",
      type: "pkcs8",
    }),
  ).toString("base64url");

  return {
    "x-kite-api-key-id": credentials.keyId,
    "x-kite-timestamp": timestamp,
    "x-kite-nonce": nonce,
    "x-kite-signature": signature,
    ...(credentials.appId ? { "x-kite-app-id": credentials.appId } : {}),
    ...(options.body === undefined
      ? {}
      : { "content-type": "application/json" }),
    ...options.headers,
  } as Record<string, string>;
};

export const call = async (
  method: string,
  path: string,
  headers: Record<string, string>,
  options: Pick<CallOptions, "body" | "query"> = {},
) => {
  const response = await app.handle(
    new Request(`http://localhost${target(path, options.query)}`, {
      method,
      headers,
      body:
        options.body === undefined ? undefined : JSON.stringify(options.body),
    }),
  );

  const text = await response.text();
  let json: any = undefined;

  try {
    json = text ? JSON.parse(text) : undefined;
  } catch {
    json = undefined;
  }

  return {
    status: response.status,
    headers: response.headers,
    json,
    text,
  };
};

export const signedCall = (
  credentials: Credentials,
  method: string,
  path: string,
  options: CallOptions = {},
) => {
  return call(
    method,
    path,
    signedHeaders(credentials, method, path, options),
    options,
  );
};

export const publicCall = (
  keyId: string,
  publicKey: string,
  method: string,
  path: string,
  options: Pick<CallOptions, "body" | "query" | "headers"> = {},
) => {
  return call(
    method,
    path,
    {
      "x-kite-api-key-id": keyId,
      "x-kite-public-key": publicKey,
      ...(options.body === undefined
        ? {}
        : { "content-type": "application/json" }),
      ...options.headers,
    },
    options,
  );
};

export const client = (credentials: Credentials) => {
  return {
    get: (path: string, query?: Record<string, string | number>) => {
      return signedCall(credentials, "GET", path, {
        query,
      });
    },
    post: (path: string, body?: unknown) => {
      return signedCall(credentials, "POST", path, {
        body,
      });
    },
    put: (path: string, body?: unknown) => {
      return signedCall(credentials, "PUT", path, {
        body,
      });
    },
    patch: (path: string, body?: unknown) => {
      return signedCall(credentials, "PATCH", path, {
        body,
      });
    },
    delete: (path: string) => signedCall(credentials, "DELETE", path),
  };
};
