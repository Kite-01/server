import {
  AppError,
  ProviderNotConfiguredForActionError,
  ProviderYetToBeConfiguredError,
} from "../errors";
import { Provider, ProviderAction } from "../constants";
import { ProviderKeyVars } from "./registry";
import { QuickNode } from "../../sdks/QuickNode";
import { Alchemy } from "../../sdks/Alchemy";

export const ProvidersMap = {
  [Provider.Alchemy]: new Alchemy(),
  [Provider.QuickNode]: new QuickNode(),
  [Provider.TrustWallet]: null,
};

export const getProvider = <T>(provider: Provider) =>
  ProvidersMap[provider] as T;

export const runProviderMethod = async <
  T extends object,
  M extends keyof T,
  R = T[M] extends (...args: any[]) => infer ReturnType
    ? Awaited<ReturnType>
    : T[M],
>(
  providers: Provider[],
  method: M,
  ...args: T[M] extends (...args: infer A) => any ? A : never
): Promise<R> => {
  let error_: unknown;

  for (const provider of providers) {
    const fn = getProvider<T>(provider)[method];
    if (typeof fn !== "function") {
      return fn as R;
    }

    try {
      return (await fn(...args)) as R;
    } catch (e) {
      error_ = e;
    }
  }

  throw (
    error_ ??
    new AppError(
      `No provider returned a valid response for method "${String(method)}"`,
    )
  );
};

export const isProviderConfiguredForAction = (
  provider: Provider,
  action: ProviderAction,
  options: SdkOptions,
) => {
  const entry = ProviderKeyVars[provider];
  const configuredVars = entry?.[action];
  if (!configuredVars) {
    throw new ProviderNotConfiguredForActionError(provider, action);
  }

  let isConfigured = true;
  const vars = options.variables;

  for (const item of configuredVars.filter((i) => i.required)) {
    if (!vars[item.key]) {
      isConfigured = false;
      break;
    }
  }

  if (!isConfigured) {
    throw new ProviderYetToBeConfiguredError(provider, action);
  }
};
