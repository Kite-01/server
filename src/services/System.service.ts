import { getOnchainActor } from "../shared/onchainActor";
import { ChainService } from "./Chain.service";
import { ChainType } from "../shared/constants";
import { getChain } from "../shared/chains";
import { version } from "../../package.json";

export class SystemService {
  getInfo = async () => {
    const operatorAddress = getOnchainActor(ChainType.Evm).getAddress();
    const chains = await new ChainService().getChains();

    return {
      version,
      operators: Object.values(ChainType).map((chainType) => ({
        chainType,
        address: getOnchainActor(chainType).getAddress(),
      })),
      chains: chains.map((chain) => {
        const registry = getChain(chain.caip2Id);
        return {
          id: chain.id,
          caip2Id: chain.caip2Id,
          name: registry.name,
          isActive: chain.isActive,
          isConfigured: !!chain.config,
          operatorAddress,
          explorerUrl: `${registry.blockExplorer.url}/address/${operatorAddress}`,
        };
      }),
    };
  };
}
