import {
  KeyType,
  KeyVarPrefix,
  KeyVars,
  Provider,
  ProviderAction,
} from "../constants";

export const ProviderKeyVars: Record<
  Provider,
  Partial<
    Record<
      ProviderAction,
      Array<{ key: KeyVars; type: KeyType; required: boolean }>
    >
  > | null
> = {
  [Provider.Alchemy]: {
    [ProviderAction.GasSponsor]: [
      {
        key: KeyVars.AlchemyApiKey,
        type: KeyType.SecureString,
        required: true,
      },
      {
        key: KeyVars.AlchemyGasPolicyId,
        type: KeyType.String,
        required: true,
      },
    ],
    [ProviderAction.OnchainNotifier]: [
      {
        key: KeyVars.AlchemyAuthToken,
        type: KeyType.SecureString,
        required: true,
      },
    ],
  },
  [Provider.QuickNode]: {
    [ProviderAction.OnchainNotifier]: [
      {
        key: KeyVars.QuickNodeApiKey,
        type: KeyType.SecureString,
        required: true,
      },
    ],
  },
  [Provider.Thirdweb]: {
    [ProviderAction.GasSponsor]: [
      {
        key: KeyVars.ThirdwebSecretKey,
        type: KeyType.SecureString,
        required: true,
      },
    ],
  },
  [Provider.TrustWallet]: null,
  [Provider.NearIntents]: {
    [ProviderAction.Payout]: [
      {
        key: KeyVars.NearIntentsApiKey,
        type: KeyType.SecureString,
        required: false,
      },
    ],
  },
};

export const SettableKeyVars = Object.fromEntries(
  Object.values(ProviderKeyVars).flatMap((actions) =>
    Object.values(actions ?? {}).flatMap((vars) =>
      vars.map((item) => [item.key, item.type]),
    ),
  ),
) as Partial<Record<KeyVars, KeyType>>;

export const KeyVarDependents: Partial<Record<KeyVars, KeyVarPrefix[]>> = {
  [KeyVars.AlchemyAuthToken]: [
    KeyVarPrefix.AlchemyAddressActivity_Webhook,
    KeyVarPrefix.AlchemyContractEvents_Webhook,
  ],
  [KeyVars.QuickNodeApiKey]: [
    KeyVarPrefix.QuickNodeEvmWalletFilter_WebhookId,
    KeyVarPrefix.QuickNodeEvmContractEvents_WebhookId,
  ],
};

export const getProviderStatuses = (variables: SdkOptions["variables"]) => {
  return Object.values(Provider).flatMap((provider) =>
    Object.entries(ProviderKeyVars[provider] ?? {}).map(([action, vars]) => ({
      provider,
      action: action as ProviderAction,
      configured: vars.every((item) => !item.required || !!variables[item.key]),
      keys: vars.map((item) => ({
        key: item.key,
        type: item.type,
        required: item.required,
        set: !!variables[item.key],
      })),
    })),
  );
};
