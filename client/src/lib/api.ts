import { client } from "@/api/client.gen";

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

let rootKey: string | null = null;
let onUnauthorized: (() => void) | null = null;

export const setRootKey = (key: string | null) => {
  rootKey = key;
};

export const setUnauthorizedHandler = (handler: (() => void) | null) => {
  onUnauthorized = handler;
};

client.interceptors.request.use((request) => {
  if (rootKey) request.headers.set("x-kite-root-key", rootKey);
  return request;
});

client.interceptors.error.use((error, response) => {
  const status = response?.status ?? 0;
  const body = error as { error?: { code?: string; message?: string } };

  if (status === 401) onUnauthorized?.();

  return new ApiError(
    status,
    body?.error?.code ?? "error",
    body?.error?.message ??
      (error instanceof Error ? error.message : `Request failed (${status})`),
  );
});
