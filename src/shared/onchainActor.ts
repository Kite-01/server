import { OnchainActor } from "../sdks/interfaces/OnchainActor";
import { ChainType } from "./constants";
import { EvmActor } from "../sdks/EvmActor";

export const OnchainActorMap = {
  [ChainType.Evm]: new EvmActor(),
};

export const getOnchainActor = <T = OnchainActor>(chainType: ChainType) => {
  return OnchainActorMap[chainType] as T;
};
