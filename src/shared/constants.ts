export enum ApiKeyScope {
  // TODO: add scopes here...
}

export enum WebhookCategory {
  Customer = "Customer",
  Transfer = "Transfer",
}

export enum FeeType {
  Fixed = "Fixed",
  Variable = "Variable",
}

export enum TransferStatus {
  Created = "Created",
  AwaitingDeposit = "AwaitingDeposit",
  DepositReceived = "DepositReceived",
  Processing = "Processing",
  Cancelled = "Cancelled",
  RefundInProgress = "RefundInProgress",
  Refunded = "Refunded",
  Failed = "Failed",
  Settled = "Settled",
}

export enum Provider {
  Alchemy = "Alchemy",
  Moralis = "Moralis",
  Nodit = "Nodit",
  QuickNode = "QuickNode",
  Pimlico = "Pimlico",
}

export enum KeyVars {
  AlchemyToken = "AlchemyToken",
  AlchemySigningKey = "AlchemySigningKey",
  AlchemyApiKey = "AlchemyApiKey",
  AlchemyGasPolicyId = "AlchemyGasPolicyId",
  MoralisApiKey = "MoralisApiKey",
  MoralisStreamsSecret = "MoralisStreamsSecret",
  NoditApiKey = "NoditApiKey",
  NoditSigningKey = "NoditSigningKey",
  QuickNodeApiKey = "QuickNodeApiKey",
  QuickNodeDestinationId = "QuickNodeDestinationId",
  QuickNodeSecurityToken = "QuickNodeSecurityToken",
  PimlicoApiKey = "PimlicoApiKey",
}

/** Canonical ERC-20 `Transfer(address,address,uint256)` topic0. */
export const ERC20_TRANSFER_TOPIC =
  "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

export const ERC20_TRANSFER_SIGNATURE = "Transfer(address,address,uint256)";

export const NATIVE_TOKEN_ADDRESS =
  "0x0000000000000000000000000000000000000000";
