type OnchainNotifierTrackAddressActivityInput = {
  caip2Id: Caip2Id;
  address: string;
};

type OnchainNotifierTrackContractEventInput = {
  caip2Id: Caip2Id;
  contractAddress: string;
};

type OnchainNotifierVerifyCallbackInput = {
  body: unknown;
  headers: Record<string, unknown>;
  rawBody?: string | Buffer;
};

type OnchainNotifierCallbackResultTemplate<T> = T & {
  caip2Id: Caip2Id;
  payinAddress: string;
  blockchainHash: string;
  logIndex: string;
};

type OnchainNotifierCallbackResultItem =
  | OnchainNotifierCallbackResultTemplate<{
      type: "DepositReceived";
      from: string;
      tokenAddress: string; // zero address for native ETH
      amount: bigint;
    }>
  | OnchainNotifierCallbackResultTemplate<{
      type: "Settled";
      transferId: string;
    }>
  | OnchainNotifierCallbackResultTemplate<{
      type: "FeePaid";
      transferId: string;
      feeId: string;
    }>
  | OnchainNotifierCallbackResultTemplate<{
      type: "Refunded";
      transferId: string;
      refundAddress: string;
      amountRefunded: bigint;
    }>
  | OnchainNotifierCallbackResultTemplate<{
      type: "ExcessRefunded";
      transferId: string;
      tokenAddress: string;
      amount: bigint;
      to: string;
    }>
  | OnchainNotifierCallbackResultTemplate<{
      type: "Recovered";
      transferId: string;
      tokenAddress: string;
      amount: bigint;
      to: string;
    }>;

type OnchainNotifierCallbackResult = Array<OnchainNotifierCallbackResultItem>;
