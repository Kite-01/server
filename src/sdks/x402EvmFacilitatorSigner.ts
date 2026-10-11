import {
  encodeFunctionData,
  verifyTypedData,
  type Address,
  type Abi,
  type Hex,
  type Log,
} from "viem";
import { type FacilitatorEvmSigner } from "@x402/evm";
import { type OnchainActor } from "./interfaces/OnchainActor";
import { getX402Observer } from "../shared/context/x402";
import { ChainService } from "../services/Chain.service";
import { KvService } from "../services/Kv.service";
import { AppError } from "../shared/errors";

export class x402EvmFacilitatorSigner implements FacilitatorEvmSigner {
  constructor(
    private readonly caip2Id: Caip2Id,
    private readonly onchainActor: OnchainActor,
  ) {}

  getAddresses = () => [this.onchainActor.getAddress() as Address];

  readContract = async (args: {
    address: Address;
    abi: readonly unknown[];
    functionName: string;
    args?: readonly unknown[];
  }): Promise<unknown> => {
    const client = await this.onchainActor.publicClient(this.caip2Id);

    return client.readContract({
      abi: args.abi as Abi,
      address: args.address,
      functionName: args.functionName,
      args: args.args,
    });
  };

  verifyTypedData = async (args: {
    address: Address;
    domain: Record<string, unknown>;
    types: Record<string, unknown>;
    primaryType: string;
    message: Record<string, unknown>;
    signature: Hex;
  }): Promise<boolean> => {
    return verifyTypedData(args as never);
  };

  writeContract = async (args: {
    address: Address;
    abi: readonly unknown[];
    functionName: string;
    args: readonly unknown[];
    gas?: bigint;
    dataSuffix?: Hex;
  }): Promise<Hex> => {
    const data = encodeFunctionData({
      abi: args.abi as Abi,
      functionName: args.functionName,
      args: args.args as never,
    });

    const withSuffix = (data: Hex, suffix?: Hex): Hex => {
      if (!suffix || suffix === "0x") return data;
      return `${data}${suffix.slice(2)}` as Hex;
    };

    return this.sendTransaction({
      to: args.address,
      data: withSuffix(data, args.dataSuffix),
    });
  };

  sendTransaction = async (args: { to: Hex; data: Hex }): Promise<Hex> => {
    const chainService = new ChainService();
    const chain = await chainService.getChainByCaip2Id(this.caip2Id);
    if (chain?.config?.maxGasPrice) {
      const gasPrice = await this.onchainActor.getGasPrice(this.caip2Id);
      if (gasPrice > chain.config.maxGasPrice) {
        throw new AppError("Gas price exceeds the configured facilitator cap");
      }
    }

    const kvService = new KvService();
    const options: SdkOptions = {
      variables: await kvService.getSdkOptionVariables(),
    };

    const observer = getX402Observer();
    const transactionHash = await this.onchainActor.sendTransaction(
      { caip2Id: this.caip2Id, to: args.to, data: args.data, value: 0n },
      options,
      { onSubmitted: observer?.onSubmitted },
    );

    await observer?.onBroadcast(transactionHash);

    return transactionHash as Hex;
  };

  waitForTransactionReceipt = async (args: {
    hash: Hex;
    timeout?: number;
  }): Promise<{ status: string; logs?: readonly Log[] }> => {
    const receipt = await this.onchainActor.waitForReceipt(
      this.caip2Id,
      args.hash,
      args.timeout,
    );

    return {
      status: receipt.status,
      logs: receipt.logs,
    };
  };

  getCode = async (args: { address: Hex }): Promise<Hex | undefined> => {
    const code = await this.onchainActor.getContractCode(
      this.caip2Id,
      args.address,
    );

    return code === "0x" ? undefined : (code as Hex);
  };
}
