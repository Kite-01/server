export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

type Query = Record<string, string | number | boolean | null | undefined>;

type RequestOptions = {
  query?: Query;
  body?: unknown;
  appId?: string;
};

let rootKey: string | null = null;
let onUnauthorized: (() => void) | null = null;

export const setRootKey = (key: string | null) => {
  rootKey = key;
};

export const setUnauthorizedHandler = (handler: (() => void) | null) => {
  onUnauthorized = handler;
};

const withQuery = (path: string, query?: Query) => {
  if (!query) return path;

  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null && value !== "") {
      search.set(key, String(value));
    }
  }

  const text = search.toString();
  return text ? `${path}?${text}` : path;
};

export const request = async <T>(
  method: string,
  path: string,
  options: RequestOptions = {},
): Promise<T> => {
  if (!rootKey) throw new ApiError(401, "unauthorized", "Not signed in");

  const body = options.body === undefined ? "" : JSON.stringify(options.body);

  const response = await fetch(withQuery(path, options.query), {
    method,
    headers: {
      "x-kite-root-key": rootKey,
      ...(options.appId ? { "x-kite-app-id": options.appId } : {}),
      ...(body ? { "content-type": "application/json" } : {}),
    },
    body: body || undefined,
  });

  const text = await response.text();
  const json = text ? JSON.parse(text) : null;

  if (!response.ok) {
    const error = json?.error;
    if (response.status === 401 && onUnauthorized) onUnauthorized();

    throw new ApiError(
      response.status,
      error?.code ?? "error",
      error?.message ?? `Request failed (${response.status})`,
    );
  }

  return json as T;
};
