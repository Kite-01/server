type JsonRpcError = {
  code: number;
  message: string;
  data?: unknown;
};

type JsonRpcResult<T> = {
  isOk: boolean;
  data?: T;
  error?: JsonRpcError;
  statusCode?: number;
};

type JsonRpcEnvelope<T> = {
  jsonrpc: "2.0";
  id: number | string;
  result?: T;
  error?: JsonRpcError;
};
