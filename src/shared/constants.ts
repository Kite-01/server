import { Kite__factory } from "@kite-01/contracts/typechain/factories/contracts/Kite__factory";
import { common } from "./common";

export enum PaymentLinkType {
  Api = "Api",
  Ui = "Ui",
}

export enum ChainType {
  Evm = "Evm",
}

export enum ApiKeyScope {
  Quote = "Quote",
  Transfer = "Transfer",
  Webhook = "Webhook",
  X402Verify = "X402Verify",
  X402Settle = "X402Settle",
}

export enum WebhookCategory {
  Transfer = "Transfer",
  Deposit = "Deposit",
  Recovery = "Recovery",
  ExcessRefund = "ExcessRefund",
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
  x402Settled = "x402Settled",
  Cancelled = "Cancelled",
  Refunded = "Refunded",
  Failed = "Failed",
  Settled = "Settled",
}

export enum Provider {
  Alchemy = "Alchemy",
  QuickNode = "QuickNode",
  TrustWallet = "TrustWallet",
}

export enum ProviderAction {
  GasSponsor = "GasSponsor",
  OnchainNotifier = "OnchainNotifier",
}

export enum KeyType {
  String = "String",
  SecureString = "SecureString",
}

export enum KeyVars {
  AlchemyApiKey = "AlchemyApiKey",
  AlchemyGasPolicyId = "AlchemyGasPolicyId",
  QuickNodeApiKey = "QuickNodeApiKey",
  QuickNodeEvmWalletFilter_WalletsListName = "QuickNodeEvmWalletFilter_WalletsListName",
  QuickNodeEvmWalletFilter_WebhookId = "QuickNodeEvmWalletFilter_WebhookId",
  QuickNodeEvmContractEvents_WebhookId = "QuickNodeEvmContractEvents_WebhookId",
  QuickNodeEvmContractEvents_ContractsListName = "QuickNodeEvmContractEvents_ContractsListName",
  QuickNodeEvmContractEvents_EventHashesListName = "QuickNodeEvmContractEvents_EventHashesListName",
  QuickNodeWebhookSecurityToken = "QuickNodeWebhookSecurityToken",
}

export const OneMinute = 60;
export const OneHour = 60 * OneMinute;
export const OneDay = 24 * OneHour;

export const QuoteTTL_Ms = 5 * OneMinute;
export const UniswapFeeTiers = [100, 500, 3000, 10000] as const;

export const KiteContractEventSignatures = [
  common.eventSignatureFromAbi(Kite__factory.abi, "Refunded"),
  common.eventSignatureFromAbi(Kite__factory.abi, "Settled"),
  common.eventSignatureFromAbi(Kite__factory.abi, "FeePaid"),
  common.eventSignatureFromAbi(Kite__factory.abi, "ExcessRefunded"),
  common.eventSignatureFromAbi(Kite__factory.abi, "Recovered"),
];

export const zeroBytes32 =
  "0x0000000000000000000000000000000000000000000000000000000000000000" as const;
