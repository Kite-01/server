import { getChain } from "./chains";
import { ChainType } from "./constants";
import { getNearActor, getStellarActor } from "./onchainActor";

// implicit accounts (64 hex, or 0x + 40 hex) come into being with their first transfer
const isNearImplicit = (account: string) =>
  /^[0-9a-f]{64}$/.test(account) || /^0x[0-9a-f]{40}$/.test(account);

// Why `address` can't receive `token` on the chain, or null when it can. EVM addresses
// always can; NEAR tokens are registered for the recipient when they're sent.
export const whyCantReceive = async (input: {
  caip2Id: Caip2Id;
  address: string;
  token: { address: string; symbol: string };
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
    const actor = getStellarActor();
    if (!(await actor.accountExists(caip2Id, address, rpcUrls)))
      return `${address} isn't activated on ${chain.name}; fund it with XLM first`;
    if (!(await actor.canHold(caip2Id, token.address, address, rpcUrls)))
      return `${address} has no trustline for ${token.symbol} on ${chain.name}; add one first`;
  }

  return null;
};
