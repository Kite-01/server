type OnchainActorTransactionInput = {
  caip2Id: Caip2Id;
  to: string;
  data?: string;
  value: bigint;
};

type OnchainActorReceipt = {
  status: "success" | "reverted";
  transactionHash: string;
  blockNumber: bigint;
  gasUsed: bigint;
  logs: Array<import("viem").Log>;
};

type OnchainActorCallStatus =
  | { status: "pending" }
  | { status: "success"; transactionHash: string }
  | { status: "failure"; transactionHash?: string };

type OnchainActorSendHooks = {
  onSubmitted?(callId: string): Promise<void>;
  useGasSponsor?: boolean;
};
