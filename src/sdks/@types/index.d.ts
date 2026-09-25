type HttpResponse<T = unknown, H = Record<string, unknown>> = {
  is_ok: boolean;
  data?: T;
  headers?: H;
  status_code?: number;
};

type SdkOptions = {
  variables: {
    [k: string]: string;
  };
};
