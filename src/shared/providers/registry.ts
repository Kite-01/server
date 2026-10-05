import { KeyVars, Provider, ProviderAction } from "../constants";

export const ProviderKeyVars: Record<
  Provider,
  Partial<
    Record<ProviderAction, Array<{ key: KeyVars; required: boolean }>>
  > | null
> = {
  [Provider.Alchemy]: {
    [ProviderAction.GasSponsor]: [
      { key: KeyVars.AlchemyApiKey, required: true },
      { key: KeyVars.AlchemyGasPolicyId, required: true },
    ],
  },
  [Provider.QuickNode]: {
    [ProviderAction.OnchainNotifier]: [
      { key: KeyVars.QuickNodeApiKey, required: true },
    ],
  },
  [Provider.TrustWallet]: null,
};
