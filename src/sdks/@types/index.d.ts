type Caip2Namespace = "eip155" | "near" | "stellar" | "gno";
type Caip2Id =
  | `eip155:${number}`
  | "near:mainnet"
  | "near:testnet"
  | "stellar:testnet"
  | "gno:onyx-1";

type HttpResponse<T = unknown, H = Record<string, unknown>> = {
  isOk: boolean;
  data?: T;
  headers?: H;
  statusCode?: number;
};

type SdkOptions = {
  variables: {
    [k: string]: string | null;
  };
};
