type AmountFilter = {
  operation: ThresholdOperator;
  value: string;
};

type OnchainNotifierModules = "Transfer";

type OnchainNotifierTrackInput = {
  caip2Id: Caip2Id;
  module: OnchainNotifierModules;
  filter: {
    address: string;
    tokenAddress: string;
    amount: AmountFilter;
  };
};

type OnchainNotifierTrackEventInput = {
  caip2Id: Caip2Id;
  module: OnchainNotifierModules;
  filter: {
    contractAddress: string;
    contractAbi: unknown;
    eventName: string;
    topics?: string[];
    // amount?: AmountFilter;
  };
};

type OnchainNotifierTrackResult = {
  correlationId: string;
};

type OnchainNotifierVerifyCallbackInput = {
  body: unknown;
  headers: Record<string, unknown>;
};

type OnchainNotifierCallbackTokenActivity = {
  recipientAddress: string;
  tokenAddress: string;
  amount: string;
};

type OnchainNotifierCallbackResult = {
  status: "depositReceived" | "belowMin" | "completed";
  correlationId: string;
  blockchainHash: string;
  sender: string;
} & (
  | {
      payinActivity: Omit<
        OnchainNotifierCallbackTokenActivity,
        "recipientAddress"
      >;
    }
  | { settlementActivity: OnchainNotifierCallbackTokenActivity }
  | { refundActivity: OnchainNotifierCallbackTokenActivity }
);
