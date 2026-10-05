type OnchainActorTransactionInput = {
  caip2Id: Caip2Id;
  to: string;
  data: string;
  value: bigint;
};

type OnchainActorReceipt = {
  status: "success" | "reverted";
  transactionHash: string;
  blockNumber: bigint;
  gasUsed: bigint;
  logs: Array<import("viem").Log>;
};
