type Caip2Namespace = "eip155" | "near";
// NEAR runs on testnet only while it's in beta
type Caip2Id = `eip155:${number}` | "near:testnet";

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
