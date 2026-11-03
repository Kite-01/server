import { OnchainActor } from "../sdks/interfaces/OnchainActor";
import { ChainType } from "./constants";
import { EvmActor } from "../sdks/EvmActor";
import { NearActor } from "../sdks/NearActor";

export const OnchainActorMap = {
  [ChainType.Evm]: new EvmActor(),
  [ChainType.Near]: new NearActor(),
};

export const getOnchainActor = <T = OnchainActor>(chainType: ChainType) => {
  return OnchainActorMap[chainType] as T;
};

export const getNearActor = () => OnchainActorMap[ChainType.Near];
