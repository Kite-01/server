import {
  ChainNotSupportedByProviderError,
  ChainNotSupportedError,
} from "../errors";
import { type Provider } from "../constants";
import { Registry } from "./registry";

export const getChain = (internalChainId: Caip2Id) => {
  const [namespace, reference] = internalChainId.split(":") as [
    Caip2Namespace,
    string,
  ];

  const chain = Registry[namespace]?.[reference];
  if (!chain) throw new ChainNotSupportedError(internalChainId);
  return chain;
};

export const providerDescriptorOfChain = <T = unknown>(
  internalChainId: Caip2Id,
  provider: Provider,
) => {
  const chain = getChain(internalChainId);
  const descriptor = chain.Descriptors?.[provider];
  if (!descriptor)
    throw new ChainNotSupportedByProviderError(internalChainId, provider);

  return descriptor as T;
};
