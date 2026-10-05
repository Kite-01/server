import { OnchainActor } from "../sdks/interfaces/OnchainActor";
import { ChainService } from "../services/Chain.service";
import { ChainType } from "./constants";
import { KvService } from "../services/Kv.service";
import { EvmActor } from "../sdks/EvmActor";

export const OnchainActorMap = {
  [ChainType.Evm]: new EvmActor(new ChainService(new KvService())),
};

export const getOnchainActor = <T = OnchainActor>(chainType: ChainType) =>
  OnchainActorMap[chainType] as T;
