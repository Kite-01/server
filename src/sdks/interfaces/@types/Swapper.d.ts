type SwapQuoteInput = {
  internalChainId: Caip2Id;
  /** Source token address; the zero address means native. */
  fromToken: string;
  /** Destination token address; the zero address means native. */
  toToken: string;
  /** Exact input amount in base units. */
  amount: bigint;
  /** The address that signs and sends the transaction. */
  fromAddress: string;
  /** Where the output must land. */
  toAddress: string;
  /** Accepted slippage as a fraction, e.g. 0.005 = 0.5%. */
  slippage: number;
};

type SwapQuote = {
  /** Provider-side quote id, for reconciliation. */
  id: string;
  internalChainId: Caip2Id;
  fromToken: string;
  toToken: string;
  /** Where the output must land, from the original request. */
  toAddress: string;
  /** Estimated output in base units. */
  estimatedAmountOut: bigint;
  /** Guaranteed minimum output (slippage applied), in base units. */
  minimumAmountOut: bigint;
  /** The ready-to-sign transaction the quote resolves to. */
  transactionRequest: {
    from: string;
    to: string;
    data: string;
    value: bigint;
    gasLimit: bigint;
  };
};

type SwapExecution = {
  transactionHash: string;
  /**
   * On-chain output actually received at the quote's `toAddress`, measured as
   * a balance delta across the transaction — verified by reading the chain.
   */
  amountReceived: bigint;
};
