type Caip2Namespace = "eip155" | "near" | "stellar";
type Caip2Id =
  `eip155:${number}` | "near:mainnet" | "near:testnet" | "stellar:testnet";

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
