import {
  createPublicClient,
  createWalletClient,
  erc20Abi,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";
import {
  AppError,
  OperatorTransactionFailedError,
  OperatorTransactionPendingError,
} from "../shared/errors";
import { getChain, getRpcsTransport, getViemChain } from "../shared/chains";
import { OperatorTxTimeoutMs, type Provider } from "../shared/constants";
import { type OnchainActor } from "./interfaces/OnchainActor";
import { mnemonicToAccount } from "viem/accounts";
import { type GasSponsor } from "./interfaces/GasSponsor";
import { ChainService } from "../services/Chain.service";
import { getProvider } from "../shared/providers";
import { common } from "../shared/common";
import { env } from "../shared/env";

export class EvmActor implements OnchainActor {
  private readonly clients = new Map<string, PublicClient>();
  private readonly account = mnemonicToAccount(env.KITE_OPERATOR_MNEMONIC);

  private rpcUrlsForChain = async (caip2Id: Caip2Id) => {
    const chain = await new ChainService().getChainByCaip2Id(caip2Id);
    return [
      ...(chain?.config?.rpcUrls ?? []),
      ...getChain(caip2Id).publicRpcUrls,
    ];
  };

  private gasSponsor = async (caip2Id: Caip2Id) => {
    const chain = await new ChainService().getChainByCaip2Id(caip2Id);
    const provider = chain?.config?.gasSponsorProviders?.[0];
    if (!provider)
      throw new AppError(`${caip2Id} does not have a gas sponsor set up`);

    return getProvider<GasSponsor>(provider);
  };

  publicClient = async (caip2Id: Caip2Id, rpcUrls?: string[]) => {
    const urls = rpcUrls?.length
      ? rpcUrls
      : await this.rpcUrlsForChain(caip2Id);

    const key = `${caip2Id}|${urls.join(",")}`;
    let client = this.clients.get(key);

    if (!client) {
      client = createPublicClient({
        chain: getViemChain(caip2Id),
        transport: getRpcsTransport(urls),
      });

      this.clients.set(key, client);
    }

    return client;
  };

  getAddress = (): string => this.account.address;

  submitTransaction = async (
    input: OnchainActorTransactionInput,
    options: SdkOptions,
  ): Promise<string> => {
    const sponsor = await this.gasSponsor(input.caip2Id);
    const result = await sponsor.submitSponsoredCalls(
      input,
      this.account,
      options,
    );

    return result.callId;
  };

  getTransactionStatus = async (
    caip2Id: Caip2Id,
    callId: string,
    options: SdkOptions,
  ): Promise<OnchainActorCallStatus> => {
    const sponsor = await this.gasSponsor(caip2Id);
    return sponsor.getSponsoredCallsStatus(
      caip2Id,
      callId,
      this.account,
      options,
    );
  };

  getSponsorshipError = async (
    caip2Id: Caip2Id,
    provider: Provider,
    options: SdkOptions,
  ): Promise<string | null> => {
    return getProvider<GasSponsor>(provider).getSponsorshipError(
      caip2Id,
      this.account,
      options,
    );
  };

  waitForTransaction = async (
    caip2Id: Caip2Id,
    callId: string,
    options: SdkOptions,
    timeoutMs = OperatorTxTimeoutMs,
  ): Promise<OnchainActorCallStatus> => {
    const sponsor = await this.gasSponsor(caip2Id);
    const deadline = Date.now() + timeoutMs;

    for (;;) {
      const status = await sponsor.getSponsoredCallsStatus(
        caip2Id,
        callId,
        this.account,
        options,
      );

      if (status.status !== "pending" || Date.now() >= deadline) {
        return status;
      }

      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  };

  sendTransaction = async (
    input: OnchainActorTransactionInput,
    options: SdkOptions,
    hooks?: OnchainActorSendHooks,
  ): Promise<string> => {
    if (hooks?.useGasSponsor === false) {
      const client = createWalletClient({
        account: this.account,
        chain: getViemChain(input.caip2Id),
        transport: getRpcsTransport(await this.rpcUrlsForChain(input.caip2Id)),
      });

      const transactionHash = await client.sendTransaction({
        account: this.account,
        to: input.to as Address,
        data: (input.data ?? "0x") as Hex,
        value: input.value,
      });

      await hooks.onSubmitted?.(transactionHash);
      return transactionHash;
    }

    const callId = await this.submitTransaction(input, options);
    await hooks?.onSubmitted?.(callId);

    const outcome = await this.waitForTransaction(
      input.caip2Id,
      callId,
      options,
    );

    if (outcome.status === "success") return outcome.transactionHash;
    if (outcome.status === "failure")
      throw new OperatorTransactionFailedError(callId, outcome.transactionHash);

    throw new OperatorTransactionPendingError(callId);
  };

  waitForReceipt = async (
    caip2Id: Caip2Id,
    transactionHash: string,
    timeoutMs = OperatorTxTimeoutMs,
  ): Promise<OnchainActorReceipt> => {
    const client = await this.publicClient(caip2Id);
    const receipt = await client.waitForTransactionReceipt({
      hash: transactionHash as Hex,
      timeout: timeoutMs,
    });

    return {
      transactionHash: receipt.transactionHash,
      blockNumber: receipt.blockNumber,
      status: receipt.status,
      gasUsed: receipt.gasUsed,
      logs: receipt.logs,
    };
  };

  getConfirmations = async (
    caip2Id: Caip2Id,
    transactionHash: string,
  ): Promise<bigint> => {
    const client = await this.publicClient(caip2Id);
    const receipt = await client
      .getTransactionReceipt({ hash: transactionHash as Hex })
      .catch(() => null);

    if (!receipt || receipt.status !== "success") {
      return 0n;
    }

    const latest = await client.getBlockNumber();
    return latest - receipt.blockNumber + 1n;
  };

  ethCall = async (
    caip2Id: Caip2Id,
    contractAddress: string,
    data: string,
    blockNumber?: bigint,
  ): Promise<string> => {
    const client = await this.publicClient(caip2Id);
    const result = await client.call({
      to: contractAddress as Address,
      data: data as Hex,
      blockNumber,
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
    const code = await client.getCode({
      address: contractAddress as Address,
    });

    return code ?? "0x";
  };

  getBlockNumber = async (caip2Id: Caip2Id): Promise<bigint> => {
    const client = await this.publicClient(caip2Id);
    return client.getBlockNumber();
  };

  getBlockTimestamp = async (
    caip2Id: Caip2Id,
    blockNumber: bigint,
  ): Promise<bigint> => {
    const client = await this.publicClient(caip2Id);
    const block = await client.getBlock({ blockNumber });
    return block.timestamp;
  };

  getGasPrice = async (caip2Id: Caip2Id): Promise<bigint> => {
    const client = await this.publicClient(caip2Id);
    return client.getGasPrice();
  };
}
