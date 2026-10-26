import {
  AppError,
  ChainNotSupportedByProviderError,
  ChainNotSupportedError,
} from "../errors";
import { defineChain, fallback, http } from "viem";
import { ChainType, Provider } from "../constants";
import { Chains } from "./registry";
import { env } from "../env";

export const getSupportedChains = () => {
  return Object.values(Chains).filter(
    (chain) => !!chain.testnet === env.KITE_IS_TESTNET,
  );
};

export const getChain = (caip2Id: Caip2Id) => {
  const chain = Chains[caip2Id];
  if (!chain || !!chain.testnet !== env.KITE_IS_TESTNET) {
    throw new ChainNotSupportedError(caip2Id);
  }

  return chain;
};

export const getRpcsTransport = (urls: string[]) => {
  return fallback(
    urls.map((url) => http(url)),
    { retryCount: 3 },
  );
};

export const getViemChain = (caip2Id: Caip2Id) => {
  const chain = getChain(caip2Id);
  if (chain.type !== ChainType.Evm) {
    throw new AppError("Only EVM-compatible chains are allowed");
  }

  return defineChain({
    id: chain.chainId,
    name: chain.name,
    nativeCurrency: chain.nativeCurrency,
    testnet: chain.testnet,
    rpcUrls: {
      default: {
        http: chain.publicRpcUrls,
      },
    },
    ...(chain.contracts.multicall3
      ? { contracts: { multicall3: chain.contracts.multicall3 } }
      : {}),
  });
};

export const providerDescriptorOfChain = <T = unknown>(
  caip2Id: Caip2Id,
  provider: Provider,
): T => {
  const chain = getChain(caip2Id);
  const descriptor = chain.descriptors?.[provider];
  if (!descriptor)
    throw new ChainNotSupportedByProviderError(caip2Id, provider);

  return descriptor as T;
};
