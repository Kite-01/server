import { OnchainActor } from "../sdks/interfaces/OnchainActor";
import { ChainType } from "./constants";
import { EvmActor } from "../sdks/EvmActor";
import { NearActor } from "../sdks/NearActor";
import { StellarActor } from "../sdks/StellarActor";
import { GnoActor } from "../sdks/GnoActor";

export const OnchainActorMap = {
  [ChainType.Evm]: new EvmActor(),
  [ChainType.Near]: new NearActor(),
  [ChainType.Stellar]: new StellarActor(),
  [ChainType.Gno]: new GnoActor(),
};

export const getOnchainActor = <T = OnchainActor>(chainType: ChainType) => {
  return OnchainActorMap[chainType] as T;
};

export const getNearActor = () => OnchainActorMap[ChainType.Near];

export const getStellarActor = () => OnchainActorMap[ChainType.Stellar];

export const getGnoActor = () => OnchainActorMap[ChainType.Gno];
