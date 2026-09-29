type Caip2Namespace = "eip155";
type Caip2Id = `${Caip2Namespace}:${number}`;

type HttpResponse<T = unknown, H = Record<string, unknown>> = {
  isOk: boolean;
  data?: T;
  headers?: H;
  statusCode?: number;
};

type SdkOptions = {
  variables: {
    [k: string]: string;
  };
};
