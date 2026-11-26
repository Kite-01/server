import { getNearActor, getStellarActor } from "./onchainActor";
import { ChainType } from "./constants";
import { getChain } from "./chains";

const isNearImplicit = (account: string) => {
  return /^[0-9a-f]{64}$/.test(account) || /^0x[0-9a-f]{40}$/.test(account);
};

export const whyCantReceive = async (input: {
  caip2Id: Caip2Id;
  address: string;
  token: {
    address: string;
    symbol: string;
  };
  rpcUrls?: string[];
}) => {
  const { caip2Id, address, token, rpcUrls } = input;
  const chain = getChain(caip2Id);

  if (chain.type === ChainType.Near) {
    if (isNearImplicit(address)) return null;
    return (await getNearActor().accountExists(caip2Id, address, rpcUrls))
      ? null
      : `${address} doesn't exist on ${chain.name}`;
  }

  if (chain.type === ChainType.Stellar) {
    const state = await getStellarActor().receivable(
      caip2Id,
      token.address,
      address,
      rpcUrls,
    );
    if (state === "unfunded")
      return `${address} isn't activated on ${chain.name}; fund it with XLM first`;
    if (state === "untrusted")
      return `${address} has no trustline for ${token.symbol} on ${chain.name}; add one first`;
  }

  return null;
};
