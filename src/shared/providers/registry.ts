import { KeyType, KeyVars, Provider, ProviderAction } from "../constants";

type ProviderKeyVar = { key: KeyVars; type: KeyType; required: boolean };

export const ProviderKeyVars: Record<
  Provider,
  Partial<Record<ProviderAction, ProviderKeyVar[]>> | null
> = {
  [Provider.Alchemy]: {
    [ProviderAction.GasSponsor]: [
      {
        key: KeyVars.AlchemyApiKey,
        type: KeyType.SecureString,
        required: true,
      },
      { key: KeyVars.AlchemyGasPolicyId, type: KeyType.String, required: true },
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
  [Provider.TrustWallet]: null,
};

/**
 * The keys an operator sets, with how they are stored. Every other key is
 * written by the provider integrations themselves.
 */
export const SettableKeyVars = Object.fromEntries(
  Object.values(ProviderKeyVars).flatMap((actions) =>
    Object.values(actions ?? {}).flatMap((vars) =>
      vars.map((item) => [item.key, item.type]),
    ),
  ),
) as Partial<Record<KeyVars, KeyType>>;

/**
 * Keys holding state created under a provider account, which no longer exists
 * once that account's key changes and has to be created again.
 */
export const KeyVarDependents: Partial<Record<KeyVars, KeyVars[]>> = {
  [KeyVars.QuickNodeApiKey]: [
    KeyVars.QuickNodeEvmWalletFilter_WebhookId,
    KeyVars.QuickNodeEvmContractEvents_WebhookId,
  ],
};

/** Every provider and what it can act as, with whether its keys are set. */
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
