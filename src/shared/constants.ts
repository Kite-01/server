import { Kite__factory } from "@kite-01/contracts/typechain/factories/contracts/Kite__factory.js";
import { common } from "./common";

export enum Queue {
  EventFanout = "EventFanout",
  WebhookDelivery = "WebhookDelivery",
  WebhookDeliveryDlq = "WebhookDeliveryDlq",
  SettleTransfer = "SettleTransfer",
  RefundTransfer = "RefundTransfer",
  RecoverTransfer = "RecoverTransfer",
  OperatorForward = "OperatorForward",
  UntrackTransfer = "UntrackTransfer",
  CheckPayout = "CheckPayout",
  TransferSweep = "TransferSweep",
  ApiNonceCleanup = "ApiNonceCleanup",
}

export enum ChainType {
  Evm = "Evm",
}

export enum ApiKeyScope {
  ApiKeyWrite = "Apikey:Write",
  ApiKeyDelete = "Apikey:Delete",
  ApiKeyRead = "Apikey:Read",
  AppWrite = "App:Write",
  AppDelete = "App:Delete",
  CustomerRead = "Customer:Read",
  CustomerWrite = "Customer:Write",
  CustomerDelete = "Customer:Delete",
  FeeRead = "Fee:Read",
  FeeWrite = "Fee:Write",
  FeeDelete = "Fee:Delete",
  PaymentLinkRead = "PaymentLink:Read",
  PaymentLinkWrite = "PaymentLink:Write",
  PaymentLinkDelete = "PaymentLink:Delete",
  QuoteRead = "quotes:read",
  QuoteWrite = "quotes:write",
  TransferRead = "Transfer:Read",
  TransferWrite = "Transfer:Write",
  WebhookRead = "Webhook:Read",
  WebhookWrite = "Webhook:Write",
  WebhookDelete = "Webhook:Delete",
  x402 = "x402",
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

export enum PaymentLinkUsage {
  OneTime = "OneTime",
  Reusable = "Reusable",
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

export const TerminalTransferStatuses: readonly TransferStatus[] = [
  TransferStatus.Cancelled,
  TransferStatus.Refunded,
  TransferStatus.Failed,
  TransferStatus.Settled,
];

export const SettleableTransferStatuses: readonly TransferStatus[] = [
  TransferStatus.AwaitingDeposit,
  TransferStatus.DepositReceived,
  TransferStatus.x402Settled,
  TransferStatus.Processing,
];

export enum OperatorForwardStatus {
  Pending = "Pending",
  Submitted = "Submitted",
  Sent = "Sent",
  Held = "Held",
  Failed = "Failed",
}

export enum OperatorForwardKind {
  Refund = "Refund",
  Excess = "Excess",
  Recovery = "Recovery",
}

export enum Provider {
  Alchemy = "Alchemy",
  QuickNode = "QuickNode",
  Thirdweb = "Thirdweb",
  TrustWallet = "TrustWallet",
  NearIntents = "NearIntents",
}

export enum ProviderAction {
  GasSponsor = "GasSponsor",
  OnchainNotifier = "OnchainNotifier",
  Payout = "Payout",
}

export enum PayoutStatus {
  Pending = "Pending",
  Processing = "Processing",
  Delivered = "Delivered",
  Refunded = "Refunded",
  Failed = "Failed",
}

export enum KeyType {
  String = "String",
  SecureString = "SecureString",
}

export enum KeyVars {
  AlchemyApiKey = "AlchemyApiKey",
  AlchemyGasPolicyId = "AlchemyGasPolicyId",
  AlchemyAuthToken = "AlchemyAuthToken",
  QuickNodeApiKey = "QuickNodeApiKey",
  QuickNodeEvmWalletFilter_WalletsListName = "QuickNodeEvmWalletFilter_WalletsListName",
  QuickNodeEvmContractEvents_ContractsListName = "QuickNodeEvmContractEvents_ContractsListName",
  QuickNodeEvmContractEvents_EventHashesListName = "QuickNodeEvmContractEvents_EventHashesListName",
  QuickNodeWebhookSecurityToken = "QuickNodeWebhookSecurityToken",
  ThirdwebSecretKey = "ThirdwebSecretKey",
  NearIntentsApiKey = "NearIntentsApiKey",
}

export enum KeyVarPrefix {
  AlchemyAddressActivity_Webhook = "AlchemyAddressActivity_Webhook",
  AlchemyContractEvents_Webhook = "AlchemyContractEvents_Webhook",
  QuickNodeEvmWalletFilter_WebhookId = "QuickNodeEvmWalletFilter_WebhookId",
  QuickNodeEvmContractEvents_WebhookId = "QuickNodeEvmContractEvents_WebhookId",
}

export type KvKey = KeyVars | `${KeyVarPrefix}:${string}`;

export const networkKeyVar = (prefix: KeyVarPrefix, network: string): KvKey =>
  `${prefix}:${network}`;

export const OneMinute = 60;
export const OneHour = 60 * OneMinute;
export const OneDay = 24 * OneHour;

export const QuoteTTLSeconds = 5 * OneMinute;
export const CancelledTransferWatchSeconds = 12 * OneHour;
export const PayoutDeadlineSeconds = OneDay;
export const PayoutDeadlineMarginSeconds = 30 * OneMinute; // a payment is never settled into a deposit address this close to its deadline
export const PayoutSlippageBufferBps = 50;
export const UniswapFeeTiers = [100, 500, 3000, 10000] as const;
export const UniswapTwapWindowsSeconds = [
  10 * OneMinute,
  5 * OneMinute,
  OneMinute,
] as const;

export const KiteMaxFees = 10;
export const OperatorTxTimeoutMs = common.toMs(2 * OneMinute);

export const x402_MaxTimeoutSeconds = 120;
export const x402_MinTimeoutSeconds = 15;
export const x402_SettlementReserveSeconds = 30;
export const x402_SettlementLeaseSeconds = 3 * OneMinute;

export const KiteContractEventTopics = (
  [
    "Refunded",
    "Settled",
    "FeePaid",
    "ExcessRefunded",
    "Recovered",
    "Initialized",
  ] as const
).map((name) => common.eventTopicFromAbi(Kite__factory.abi, name)!);

export const zeroBytes32 =
  "0x0000000000000000000000000000000000000000000000000000000000000000" as const;
