export interface OnchainActor {
  getAddress(): string;

  publicClient(
    caip2Id: Caip2Id,
    rpcUrls?: string[],
  ): Promise<import("viem").PublicClient>;

  /** Submits a sponsored call without waiting; returns its call id. */
  submitTransaction(
    input: OnchainActorTransactionInput,
    options: SdkOptions,
  ): Promise<string>;

  getTransactionStatus(
    caip2Id: Caip2Id,
    callId: string,
    options: SdkOptions,
  ): Promise<OnchainActorCallStatus>;

  /** Polls until the call is final or `timeoutMs` passes (then reports `pending`). */
  waitForTransaction(
    caip2Id: Caip2Id,
    callId: string,
    options: SdkOptions,
    timeoutMs?: number,
  ): Promise<OnchainActorCallStatus>;

  /**
   * Submits and waits; returns the transaction hash. Throws
   * `OperatorTransactionFailedError` or, when the outcome is still unknown,
   * `OperatorTransactionPendingError`.
   */
  sendTransaction(
    input: OnchainActorTransactionInput,
    options: SdkOptions,
    hooks?: OnchainActorSendHooks,
  ): Promise<string>;

  waitForReceipt(
    caip2Id: Caip2Id,
    transactionHash: string,
    timeoutMs?: number,
  ): Promise<OnchainActorReceipt>;

  /** Blocks since the transaction was mined (0 when unknown or reverted). */
  getConfirmations(caip2Id: Caip2Id, transactionHash: string): Promise<bigint>;

  ethCall(
    caip2Id: Caip2Id,
    contractAddress: string,
    data: string,
  ): Promise<string>;

  getBalance(
    caip2Id: Caip2Id,
    tokenAddress: string,
    address: string,
  ): Promise<bigint>;

  getContractCode(caip2Id: Caip2Id, contractAddress: string): Promise<string>;

  getBlockNumber(caip2Id: Caip2Id): Promise<bigint>;

  getGasPrice(caip2Id: Caip2Id): Promise<bigint>;
}
