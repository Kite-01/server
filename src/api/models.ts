import {
  ApiKeyScope,
  ChainType,
  FeeType,
  KeyType,
  KeyVars,
  PaymentLinkUsage,
  Provider,
  ProviderAction,
  TransferStatus,
  WebhookCategory,
} from "../shared/constants";
import { type Static, type TSchema, Type } from "@sinclair/typebox";
import { Digits, EvmAddress, t, Uuid } from "./schema";
import { Elysia } from "elysia";

const named = (name: string) => {
  return { $id: `#/components/schemas/${name}` };
};

const ref = <T extends TSchema>(schema: T) => {
  return t.Unsafe<Static<T>>(t.Ref(schema.$id!));
};

const Nullable = <T extends TSchema>(schema: T) => {
  return t.Union([schema, t.Null()]);
};

const List = <T extends TSchema>(name: string, item: T) => {
  return t.Array(ref(item), named(name));
};

const Page = <T extends TSchema>(name: string, item: T) => {
  return t.Object(
    { data: t.Array(ref(item)), page: Int, pageSize: Int, total: Int },
    named(name),
  );
};

const Int = Type.Integer();
const Json = t.Record(t.String(), t.Unknown());
const BigIntString = t.Unsafe<bigint>(Digits);
const Timestamp = t.Unsafe<Date>(t.String({ format: "date-time" }));

const App = t.Object(
  {
    id: Uuid,
    name: t.String(),
    icon: Nullable(t.String()),
    websiteUrl: Nullable(t.String()),
    termsOfServiceUrl: Nullable(t.String()),
    privacyPolicyUrl: Nullable(t.String()),
    settlementAddress: Nullable(EvmAddress),
    deletedAt: Nullable(Timestamp),
    createdAt: Timestamp,
    updatedAt: Timestamp,
  },
  named("App"),
);

const ApiKey = t.Object(
  {
    id: Uuid,
    appId: Uuid,
    label: t.String(),
    publicKey: t.String(),
    scopes: t.Array(t.Enum(ApiKeyScope)),
    lastUsedAt: Nullable(Timestamp),
    revokedAt: Nullable(Timestamp),
    expiresAt: Nullable(Timestamp),
    createdAt: Timestamp,
    updatedAt: Timestamp,
  },
  named("ApiKey"),
);

const Chain = t.Object(
  {
    id: Uuid,
    isActive: t.Boolean(),
    caip2Id: t.String(),
    deletedAt: Nullable(Timestamp),
    createdAt: Timestamp,
    updatedAt: Timestamp,
  },
  named("Chain"),
);

const Token = t.Object(
  {
    id: Uuid,
    chainId: Uuid,
    address: EvmAddress,
    symbol: t.String(),
    decimals: Int,
    name: t.String(),
    version: Nullable(t.String()),
    icon: Nullable(t.String()),
    supportsEIP3009: t.Boolean(),
    listed: t.Boolean(),
    deletedAt: Nullable(Timestamp),
    createdAt: Timestamp,
    updatedAt: Timestamp,
  },
  named("Token"),
);

const TokenWithChain = t.Object(
  { ...Token.properties, chain: ref(Chain) },
  named("TokenWithChain"),
);

const ChainConfig = t.Object(
  {
    chainId: Uuid,
    rpcUrls: Nullable(t.Array(t.String())),
    slippageBps: Int,
    kiteFactoryAddress: EvmAddress,
    usdPeggedTokenId: Uuid,
    settlementTokenId: Uuid,
    onchainNotifierProviders: t.Array(t.Enum(Provider)),
    gasSponsorProviders: t.Array(t.Enum(Provider)),
    maxGasPrice: Nullable(BigIntString),
    createdAt: Timestamp,
    updatedAt: Timestamp,
    settlementToken: ref(Token),
    usdPeggedToken: ref(Token),
  },
  named("ChainConfig"),
);

const ChainWithConfig = t.Object(
  { ...Chain.properties, config: Nullable(ref(ChainConfig)) },
  named("ChainWithConfig"),
);

const ConfiguredChain = t.Object(
  {
    id: Uuid,
    caip2Id: t.String(),
    name: t.String(),
    settlementToken: ref(Token),
    usdPeggedToken: ref(Token),
  },
  named("ConfiguredChain"),
);

const SupportedChain = t.Object(
  {
    caip2Id: t.String(),
    name: t.String(),
    chainId: Int,
    testnet: t.Boolean(),
    nativeCurrency: t.Object({
      name: t.String(),
      symbol: t.String(),
      decimals: Int,
    }),
    blockExplorer: t.Optional(
      t.Object({
        name: t.String(),
        url: t.String(),
      }),
    ),
    confirmations: Int,
  },
  named("SupportedChain"),
);

const Customer = t.Object(
  {
    id: Uuid,
    appId: Uuid,
    externalId: t.String(),
    name: Nullable(t.String()),
    traits: Nullable(Json),
    createdAt: Timestamp,
    updatedAt: Timestamp,
  },
  named("Customer"),
);

const Fee = t.Object(
  {
    id: Uuid,
    appId: Nullable(Uuid),
    chainId: Uuid,
    label: t.String(),
    type: t.Enum(FeeType),
    value: BigIntString,
    minAmountToCharge: Nullable(BigIntString),
    maxAmountToCharge: Nullable(BigIntString),
    condition: Json,
    feeAddress: Nullable(EvmAddress),
    createdAt: Timestamp,
    updatedAt: Timestamp,
  },
  named("Fee"),
);

const FeeWithChain = t.Object(
  { ...Fee.properties, chain: ref(Chain) },
  named("FeeWithChain"),
);

const PaymentLink = t.Object(
  {
    id: Uuid,
    appId: Uuid,
    title: t.String(),
    currency: t.String(),
    amount: t.String(),
    usage: t.Enum(PaymentLinkUsage),
    lineItems: t.Unsafe<unknown>(
      Nullable(
        t.Array(
          t.Object({
            image: t.Optional(Nullable(t.String())),
            name: t.String(),
            price: t.String(),
            quantity: t.Number(),
          }),
        ),
      ),
    ),
    reference: Nullable(t.String()),
    meta: t.Unsafe<unknown>(Nullable(Json)),
    returnUrl: Nullable(t.String()),
    createdAt: Timestamp,
    updatedAt: Timestamp,
  },
  named("PaymentLink"),
);

const PriceFeed = t.Object(
  {
    id: Uuid,
    chainId: Uuid,
    baseCurrency: t.String(),
    quoteCurrency: t.String(),
    address: EvmAddress,
    decimals: Int,
    createdAt: Timestamp,
    updatedAt: Timestamp,
  },
  named("PriceFeed"),
);

const PriceFeedWithChain = t.Object(
  {
    ...PriceFeed.properties,
    chain: ref(Chain),
    rate: Nullable(t.String()),
  },
  named("PriceFeedWithChain"),
);

const Quote = t.Object(
  {
    id: Uuid,
    appId: Uuid,
    chainId: Uuid,
    paymentLinkId: Nullable(Uuid),
    customerId: Nullable(Uuid),
    sourceTokenId: Uuid,
    targetTokenId: Uuid,
    sourceUsdAmount: t.String(),
    sourceAmount: BigIntString,
    targetAmount: BigIntString,
    targetUsdAmount: t.String(),
    rate: t.String(),
    uniswapPoolFeeTier: Nullable(Int),
    reference: Nullable(t.String()),
    meta: t.Unsafe<unknown>(Nullable(Json)),
    expiresAt: Timestamp,
    createdAt: Timestamp,
    updatedAt: Timestamp,
  },
  named("Quote"),
);

const QuoteFee = t.Object(
  {
    id: Uuid,
    quoteId: Uuid,
    feeId: Nullable(Uuid),
    label: t.String(),
    amount: BigIntString,
    feeAddress: EvmAddress,
    blockchainHash: Nullable(t.String()),
    createdAt: Timestamp,
  },
  named("QuoteFee"),
);

const QuoteDetails = t.Object(
  {
    ...Quote.properties,
    customer: Nullable(ref(Customer)),
    paymentLink: Nullable(ref(PaymentLink)),
    chain: ref(Chain),
    sourceToken: ref(Token),
    targetToken: ref(Token),
    fees: t.Array(ref(QuoteFee)),
  },
  named("QuoteDetails"),
);

const Transfer = t.Object(
  {
    id: Uuid,
    appId: Uuid,
    quoteId: Uuid,
    settlementRecipient: EvmAddress,
    minAmountOut: BigIntString,
    refundAddress: EvmAddress,
    payinAddress: EvmAddress,
    kiteTransferInput: t.Object({
      id: t.String(),
      payInTokenAddress: EvmAddress,
      amountIn: Digits,
      settlementTokenAddress: EvmAddress,
      settlementRecipient: EvmAddress,
      minAmountOut: Digits,
      fees: t.Array(
        t.Object({
          id: t.String(),
          recipient: EvmAddress,
          amount: Digits,
        }),
      ),
      refundAddress: EvmAddress,
      expiresAt: Digits,
      routerAddress: EvmAddress,
      poolFeeTier: Int,
      implementation: EvmAddress,
    }),
    status: t.Enum(TransferStatus),
    settlementBlockchainHash: Nullable(t.String()),
    refundBlockchainHash: Nullable(t.String()),
    x402Payer: Nullable(t.String()),
    x402AuthorizationNonce: Nullable(t.String()),
    x402AuthorizationHash: Nullable(t.String()),
    x402SettlementCallId: Nullable(t.String()),
    x402BlockchainHash: Nullable(t.String()),
    x402LeaseExpiresAt: Nullable(Timestamp),
    x402SettledAt: Nullable(Timestamp),
    x402Offer: t.Boolean(),
    createdAt: Timestamp,
    updatedAt: Timestamp,
  },
  named("Transfer"),
);

const TransferTimelineEntry = t.Object(
  {
    id: Uuid,
    transferId: Uuid,
    eventId: Uuid,
    description: t.String(),
    createdAt: Timestamp,
  },
  named("TransferTimelineEntry"),
);

const TransferDetails = t.Object(
  {
    ...Transfer.properties,
    timeline: t.Array(ref(TransferTimelineEntry)),
    quote: ref(QuoteDetails),
  },
  named("TransferDetails"),
);

const TransferListItem = t.Object(
  {
    ...TransferDetails.properties,
    app: t.Object({
      id: Uuid,
      icon: Nullable(t.String()),
      name: t.String(),
    }),
  },
  named("TransferListItem"),
);

const CreatedTransfer = t.Object(
  {
    ...Transfer.properties,
    paymentInstructions: t.Object({
      caip2Id: t.String(),
      address: EvmAddress,
      tokenAddress: EvmAddress,
      amount: Digits,
      expiresAt: Timestamp,
    }),
  },
  named("CreatedTransfer"),
);

const Webhook = t.Object(
  {
    id: Uuid,
    appId: Uuid,
    url: t.String(),
    label: t.String(),
    categories: t.Array(t.Enum(WebhookCategory)),
    signingKeyHint: t.String(),
    maxRetries: Int,
    retryIntervalInSeconds: Int,
    timeoutInSeconds: Int,
    deletedAt: Nullable(Timestamp),
    createdAt: Timestamp,
    updatedAt: Timestamp,
  },
  named("Webhook"),
);

const CreatedWebhook = t.Object(
  {
    ...Webhook.properties,
    signingKey: t.String(),
  },
  named("CreatedWebhook"),
);

const WebhookDelivery = t.Object(
  {
    id: Uuid,
    webhookId: Uuid,
    eventId: Uuid,
    attempt: Int,
    error: Nullable(t.String()),
    httpResponseCode: Nullable(Int),
    httpResponseHeaders: t.Unsafe<unknown>(
      Nullable(t.Record(t.String(), t.String())),
    ),
    httpResponseBody: Nullable(t.String()),
    startedAt: Timestamp,
    completedAt: Nullable(Timestamp),
    nextRetryAt: Nullable(Timestamp),
    createdAt: Timestamp,
    updatedAt: Timestamp,
  },
  named("WebhookDelivery"),
);

const Event = t.Object(
  {
    id: Uuid,
    sourceId: Nullable(t.String()),
    appId: Uuid,
    category: t.Enum(WebhookCategory),
    previousCategoryStatus: Nullable(t.String()),
    currentCategoryStatus: t.String(),
    data: t.Unknown(),
    createdAt: Timestamp,
  },
  named("Event"),
);

const KvEntry = t.Object(
  {
    key: t.String(),
    type: t.Enum(KeyType),
    value: Nullable(t.String()),
    createdAt: Timestamp,
    updatedAt: Timestamp,
  },
  named("KvEntry"),
);

const ProviderStatus = t.Object(
  {
    provider: t.Enum(Provider),
    action: t.Enum(ProviderAction),
    configured: t.Boolean(),
    keys: t.Array(
      t.Object({
        key: t.Enum(KeyVars),
        type: t.Enum(KeyType),
        required: t.Boolean(),
        set: t.Boolean(),
      }),
    ),
  },
  named("ProviderStatus"),
);

const SystemInfo = t.Object(
  {
    version: t.String(),
    operators: t.Array(
      t.Object({
        chainType: t.Enum(ChainType),
        address: t.String(),
      }),
    ),
    chains: t.Array(
      t.Object({
        id: Uuid,
        caip2Id: t.String(),
        name: t.String(),
        isActive: t.Boolean(),
        isConfigured: t.Boolean(),
        operatorAddress: EvmAddress,
        explorerUrl: t.Union([t.String(), t.Null()]),
      }),
    ),
  },
  named("SystemInfo"),
);

const Stats = t.Object(
  {
    from: t.String({
      format: "date-time",
    }),
    to: t.String({
      format: "date-time",
    }),
    timeZone: t.String(),
    customers: t.Object({
      total: Int,
      change: Nullable(t.Number()),
    }),
    amountProcessed: t.Object({
      amount: t.String(),
      count: Int,
      change: Nullable(t.Number()),
    }),
    series: t.Array(
      t.Object({
        bucket: t.String(),
        amount: t.String(),
        count: Int,
      }),
    ),
    topTokens: t.Array(
      t.Object({
        id: Uuid,
        symbol: t.String(),
        name: t.String(),
        icon: Nullable(t.String()),
        decimals: Int,
        address: EvmAddress,
        chainId: Uuid,
        volume: Int,
        value: t.String(),
      }),
    ),
  },
  named("Stats"),
);

const x402Supported = t.Object(
  {
    kinds: t.Array(
      t.Object({
        x402Version: Int,
        scheme: t.String(),
        network: t.String(),
        extra: t.Optional(Json),
      }),
    ),
    extensions: t.Array(t.Unknown()),
    signers: t.Record(t.String(), t.Array(EvmAddress)),
  },
  named("x402Supported"),
);

const x402PaymentRequirements = t.Object(
  {
    scheme: t.Literal("exact"),
    network: t.String(),
    asset: EvmAddress,
    amount: Digits,
    payTo: EvmAddress,
    maxTimeoutSeconds: Int,
    extra: t.Object({
      name: t.String(),
      version: t.String(),
    }),
  },
  named("x402PaymentRequirements"),
);

const x402VerifyResult = t.Object(
  {
    isValid: t.Boolean(),
    invalidReason: t.Optional(t.String()),
    invalidMessage: t.Optional(t.String()),
    payer: t.Optional(t.String()),
    extensions: t.Optional(Json),
    extensionResponses: t.Optional(Json),
    extra: t.Optional(Json),
  },
  { ...named("x402VerifyResult"), additionalProperties: true },
);

const x402SettleResult = t.Object(
  {
    success: t.Boolean(),
    errorReason: t.Optional(t.String()),
    errorMessage: t.Optional(t.String()),
    payer: t.Optional(t.String()),
    transaction: t.String(),
    network: t.String(),
    amount: t.Optional(t.String()),
    extensions: t.Optional(Json),
    extensionResponses: t.Optional(Json),
    extra: t.Optional(Json),
  },
  { ...named("x402SettleResult"), additionalProperties: true },
);

const Checkout = t.Object(
  {
    paymentLink: t.Object({
      id: Uuid,
      title: t.String(),
      currency: t.String(),
      amount: t.String(),
      usage: t.Enum(PaymentLinkUsage),
      lineItems: PaymentLink.properties.lineItems,
      returnUrl: Nullable(t.String()),
    }),
    app: t.Object({
      name: t.String(),
      icon: Nullable(t.String()),
      websiteUrl: Nullable(t.String()),
      termsOfServiceUrl: Nullable(t.String()),
      privacyPolicyUrl: Nullable(t.String()),
    }),
    chains: t.Array(
      t.Object({
        id: Uuid,
        caip2Id: t.String(),
        name: t.String(),
        chainId: Int,
        testnet: t.Boolean(),
        icon: t.String(),
        nativeCurrency: SupportedChain.properties.nativeCurrency,
        blockExplorer: SupportedChain.properties.blockExplorer,
        rpcUrls: t.Array(t.String()),
        settlementToken: t.Object({
          address: EvmAddress,
          symbol: t.String(),
          name: t.String(),
          decimals: Int,
          icon: Nullable(t.String()),
          x402: t.Boolean(),
        }),
        tokens: t.Array(
          t.Object({
            address: EvmAddress,
            symbol: t.String(),
            name: t.String(),
            decimals: Int,
            icon: Nullable(t.String()),
            x402: t.Boolean(),
          }),
        ),
      }),
    ),
  },
  named("Checkout"),
);

const CheckoutTransfer = t.Object(
  {
    id: Uuid,
    status: t.Enum(TransferStatus),
    payinAddress: EvmAddress,
    x402BlockchainHash: Nullable(t.String()),
    settlementBlockchainHash: Nullable(t.String()),
    refundBlockchainHash: Nullable(t.String()),
    expiresAt: Timestamp,
    updatedAt: Timestamp,
  },
  named("CheckoutTransfer"),
);

export const models = new Elysia({ name: "Models" }).model({
  App,
  AppPage: Page("AppPage", App),
  ApiKey,
  ApiKeyPage: Page("ApiKeyPage", ApiKey),
  Chain,
  ChainConfig,
  ChainWithConfig,
  ChainWithConfigList: List("ChainWithConfigList", ChainWithConfig),
  ConfiguredChain,
  ConfiguredChainList: t.Object(
    { data: t.Array(ref(ConfiguredChain)) },
    named("ConfiguredChainList"),
  ),
  SupportedChain,
  SupportedChainList: List("SupportedChainList", SupportedChain),
  Token,
  TokenWithChain,
  TokenPage: Page("TokenPage", TokenWithChain),
  Customer,
  CustomerPage: Page("CustomerPage", Customer),
  Fee,
  FeeWithChain,
  FeePage: Page("FeePage", FeeWithChain),
  PaymentLink,
  PaymentLinkPage: Page("PaymentLinkPage", PaymentLink),
  PriceFeed,
  PriceFeedWithChain,
  PriceFeedWithChainList: List("PriceFeedWithChainList", PriceFeedWithChain),
  Quote,
  QuoteFee,
  QuoteDetails,
  QuotePage: Page("QuotePage", QuoteDetails),
  Transfer,
  TransferTimelineEntry,
  TransferDetails,
  TransferListItem,
  TransferPage: Page("TransferPage", TransferListItem),
  CreatedTransfer,
  Webhook,
  WebhookPage: Page("WebhookPage", Webhook),
  CreatedWebhook,
  WebhookDelivery,
  WebhookDeliveryPage: Page("WebhookDeliveryPage", WebhookDelivery),
  Event,
  EventPage: Page("EventPage", Event),
  KvEntry,
  KvEntryList: List("KvEntryList", KvEntry),
  ProviderStatus,
  ProviderStatusList: List("ProviderStatusList", ProviderStatus),
  SystemInfo,
  Stats,
  x402Supported,
  x402PaymentRequirements,
  x402VerifyResult,
  x402SettleResult,
  Checkout,
  CheckoutTransfer,
});
