export interface OnchainActor {
  getAddress(): string;

  publicClient(
    caip2Id: Caip2Id,
    rpcUrls?: string[],
  ): Promise<import("viem").PublicClient>;

  submitTransaction(
    input: OnchainActorTransactionInput,
    options: SdkOptions,
  ): Promise<string>;

  getTransactionStatus(
    caip2Id: Caip2Id,
    callId: string,
    options: SdkOptions,
  ): Promise<OnchainActorCallStatus>;

  getSponsorshipError(
    caip2Id: Caip2Id,
    provider: import("../../shared/constants").Provider,
    options: SdkOptions,
  ): Promise<string | null>;

  waitForTransaction(
    caip2Id: Caip2Id,
    callId: string,
    options: SdkOptions,
    timeoutMs?: number,
  ): Promise<OnchainActorCallStatus>;

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
