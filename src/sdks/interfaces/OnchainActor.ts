export interface OnchainActor {
  getAddress(): string;

  publicClient(
    caip2Id: Caip2Id,
    rpcUrls?: string[],
  ): Promise<import("viem").PublicClient>;

  sendTransaction(
    input: OnchainActorTransactionInput,
    options: SdkOptions,
  ): Promise<string>;

  waitForReceipt(
    caip2Id: Caip2Id,
    transactionHash: string,
  ): Promise<OnchainActorReceipt>;

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
