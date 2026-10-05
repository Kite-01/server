import {
  Abi,
  createPublicClient,
  erc20Abi,
  type Address,
  type Hex,
} from "viem";
import { getChain, getRpcsTransport, getViemChain } from "../shared/chains";
import { privateKeyToAccount } from "viem/accounts";
import { type OnchainActor } from "./interfaces/OnchainActor";
import { type ChainService } from "../services/Chain.service";
import { type GasSponsor } from "./interfaces/GasSponsor";
import { getProvider } from "../shared/providers";
import { AppError } from "../shared/errors";
import { common } from "../shared/common";
import { env } from "../shared/env";

export class EvmActor implements OnchainActor {
  constructor(private readonly chainService: ChainService) {}

  private account = privateKeyToAccount(env.KITE_ADMIN_PRIVATE_KEY as Hex);

  private getRpcTransportForChain = async (caip2Id: Caip2Id) => {
    const urls: string[] = [];

    const chain = await this.chainService.getChainByCaip2Id(caip2Id);
    if (chain && chain.config?.rpcUrls?.length) {
      urls.push(...chain.config.rpcUrls);
    }

    urls.push(...getChain(caip2Id).publicRpcUrls);

    return getRpcsTransport(urls);
  };

  publicClient = async (caip2Id: Caip2Id, rpcUrls?: string[]) => {
    const transport = rpcUrls?.length
      ? getRpcsTransport(rpcUrls)
      : await this.getRpcTransportForChain(caip2Id);

    return createPublicClient({
      chain: getViemChain(caip2Id),
      transport,
    });
  };

  getAddress = (): string => this.account.address.toLowerCase();

  sendTransaction = async (
    input: OnchainActorTransactionInput,
    options: SdkOptions,
  ): Promise<string> => {
    const chain = await this.chainService.getChainByCaip2Id(input.caip2Id);
    const provider = chain?.config?.gasSponsorProviders?.[0];
    if (!provider)
      throw new AppError(`${input.caip2Id} does not have a gas sponsor set up`);

    return getProvider<GasSponsor>(provider).sendSponsoredTransaction(
      input,
      this.account,
      options,
    );
  };

  waitForReceipt = async (
    caip2Id: Caip2Id,
    transactionHash: string,
  ): Promise<OnchainActorReceipt> => {
    const client = await this.publicClient(caip2Id);
    const receipt = await client.waitForTransactionReceipt({
      hash: transactionHash as Hex,
    });

    return {
      transactionHash: receipt.transactionHash,
      blockNumber: receipt.blockNumber,
      status: receipt.status,
      gasUsed: receipt.gasUsed,
      logs: receipt.logs,
    };
  };

  ethCall = async (
    caip2Id: Caip2Id,
    contractAddress: string,
    data: string,
  ): Promise<string> => {
    const client = await this.publicClient(caip2Id);
    const result = await client.call({
      to: contractAddress as Address,
      data: data as Hex,
    });

    return result.data ?? "0x";
  };

  getBalance = async (
    caip2Id: Caip2Id,
    tokenAddress: string,
    address: string,
  ): Promise<bigint> => {
    const client = await this.publicClient(caip2Id);

    if (common.isZeroAddress(tokenAddress)) {
      return client.getBalance({ address: address as Address });
    }

    return client.readContract({
      address: tokenAddress as Address,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [address as Address],
    });
  };

  getContractCode = async (
    caip2Id: Caip2Id,
    contractAddress: string,
  ): Promise<string> => {
    const client = await this.publicClient(caip2Id);
    const code = await client.getBytecode({
      address: contractAddress as Address,
    });

    return code ?? "0x";
  };

  getBlockNumber = async (caip2Id: Caip2Id): Promise<bigint> => {
    const client = await this.publicClient(caip2Id);
    return client.getBlockNumber();
  };

  getGasPrice = async (caip2Id: Caip2Id): Promise<bigint> => {
    const client = await this.publicClient(caip2Id);
    return client.getGasPrice();
  };
}
