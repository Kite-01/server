type OnchainNotifierTrackInput = {
  internalChainId: string;
  filter: {
    address: string;
    tokenAddress?: string;
    amount?: {
      operation: Omit<ComparisonOperator, "_neq">;
      value: string;
    };
  };
};

type OnchainNotifierTrackEventInput = {
  internalChainId: string;
  filter: {
    contractAddress: string;
    contractAbi?: Record<string, unknown>;
    eventName: string;
    eventSignature?: string;
    match?: Array<{
      param: string;
      operation: ComparisonOperator;
      value: string;
    }>;
  };
};

type OnchainNotifierTrackResult = {
  correlationId: string;
};

type OnchainNotifierVerifyCallbackInput = {
  body: Record<string, unknown>;
  headers: Record<string, unknown>;
};

type OnchainNotifierCallbackResult = {};
