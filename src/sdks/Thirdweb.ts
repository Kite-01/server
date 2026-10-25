import {
  type Address,
  type Hex,
  type LocalAccount,
  isAddressEqual,
  numberToHex,
  toEventSelector,
  toHex,
} from "viem";
import { KeyVars, Provider } from "../shared/constants";
import { type GasSponsor } from "./interfaces/GasSponsor";
import { getOnchainActor } from "../shared/onchainActor";
import { SdkRequestError } from "../shared/errors";
import { randomBytes } from "node:crypto";
import { getChain } from "../shared/chains";
import { common } from "../shared/common";
import { Http } from "./Http";

type RpcResponse<T> = {
  result?: T;
  error?: string | { code?: number; message?: string };
};

const ExecutedTopic = toEventSelector(
  "Executed(address,address,address,uint256)",
);

export class Thirdweb implements GasSponsor {
  private getClient = (caip2Id: Caip2Id, options: SdkOptions) => {
    return new Http(
      `https://${getChain(caip2Id).chainId}.bundler.thirdweb.com/v2`,
      {
        "x-secret-key": common.requireVar(options, KeyVars.ThirdwebSecretKey),
        "Content-Type": "application/json",
        Accept: "application/json",
      },
    );
  };

  private rpc = <T>(
    caip2Id: Caip2Id,
    method: string,
    params: unknown[],
    options: SdkOptions,
  ) => {
    return this.getClient(caip2Id, options).post<RpcResponse<T>>("", {
      id: 1,
      jsonrpc: "2.0",
      method,
      params,
    });
  };

  private requestError = (
    method: string,
    response: HttpResponse<RpcResponse<unknown>>,
  ) => {
    const error = response.data?.error;
    return new SdkRequestError(
      Provider.Thirdweb,
      method,
      response,
      typeof error === "string" ? error : error?.message,
    );
  };

  private getDelegationContract = async (
    caip2Id: Caip2Id,
    options: SdkOptions,
  ) => {
    const method = "tw_getDelegationContract";
    const response = await this.rpc<{ delegationContract: Address }>(
      caip2Id,
      method,
      [],
      options,
    );

    const delegationContract = response.data?.result?.delegationContract;
    if (!response.isOk || !delegationContract) {
      throw this.requestError(method, response);
    }

    return delegationContract;
  };

  submitSponsoredCalls = async (
    input: OnchainActorTransactionInput,
    signer: LocalAccount,
    options: SdkOptions,
  ): Promise<{ callId: string }> => {
    const chain = getChain(input.caip2Id);
    const client = await getOnchainActor(chain.type).publicClient(
      input.caip2Id,
    );

    const delegationContract = await this.getDelegationContract(
      input.caip2Id,
      options,
    );

    const code = await client.getCode({ address: signer.address });
    const authorization =
      code?.toLowerCase() ===
      `0xef0100${delegationContract.slice(2)}`.toLowerCase()
        ? null
        : await signer.signAuthorization!({
            chainId: chain.chainId,
            contractAddress: delegationContract,
            nonce: await client.getTransactionCount({
              address: signer.address,
              blockTag: "pending",
            }),
          });

    const calls = [
      {
        target: input.to as Address,
        value: input.value,
        data: (input.data ?? "0x") as Hex,
      },
    ];

    const uid = toHex(randomBytes(32));
    const signature = await signer.signTypedData({
      domain: {
        name: "MinimalAccount",
        version: "1",
        chainId: chain.chainId,
        verifyingContract: signer.address,
      },
      types: {
        Call: [
          { name: "target", type: "address" },
          { name: "value", type: "uint256" },
          { name: "data", type: "bytes" },
        ],
        WrappedCalls: [
          { name: "calls", type: "Call[]" },
          { name: "uid", type: "bytes32" },
        ],
      },
      primaryType: "WrappedCalls",
      message: { calls, uid },
    });

    const method = "tw_execute";
    const response = await this.rpc<{ queueId: string }>(
      input.caip2Id,
      method,
      [
        signer.address,
        {
          calls: calls.map((call) => ({
            ...call,
            value: numberToHex(call.value),
          })),
          uid,
        },
        signature,
        authorization && {
          chainId: authorization.chainId,
          address: authorization.address,
          nonce: numberToHex(authorization.nonce),
          yParity: authorization.yParity,
          r: authorization.r,
          s: authorization.s,
        },
      ],
      options,
    );

    const queueId = response.data?.result?.queueId;
    if (!response.isOk || !queueId) {
      throw this.requestError(method, response);
    }

    return { callId: queueId };
  };

  getSponsoredCallsStatus = async (
    caip2Id: Caip2Id,
    callId: string,
    signer: LocalAccount,
    options: SdkOptions,
  ): Promise<OnchainActorCallStatus> => {
    const method = "tw_getTransactionHash";
    const response = await this.rpc<{ transactionHash: Hex | null }>(
      caip2Id,
      method,
      [callId],
      options,
    );

    const error = response.data?.error;
    if (
      typeof error === "object" &&
      error.code === -32000 &&
      error.message?.toLowerCase().startsWith("transaction failed")
    ) {
      return {
        status: "failure",
      };
    }

    if (!response.isOk || error) {
      throw this.requestError(method, response);
    }

    const transactionHash = response.data?.result?.transactionHash;
    if (!transactionHash) {
      return {
        status: "pending",
      };
    }

    const client = await getOnchainActor(getChain(caip2Id).type).publicClient(
      caip2Id,
    );

    const receipt = await client
      .getTransactionReceipt({ hash: transactionHash })
      .catch(() => null);

    if (!receipt) {
      return {
        status: "pending",
      };
    }

    // thirdweb reports success even when nothing ran,
    // e.g. the operator wasn't delegated because its authorization went stale
    const executed = receipt.logs.some(
      (log) =>
        isAddressEqual(log.address, signer.address) &&
        log.topics[0] === ExecutedTopic,
    );

    return receipt.status === "success" && executed
      ? { status: "success", transactionHash }
      : { status: "failure", transactionHash };
  };

  getSponsorshipError = async (
    caip2Id: Caip2Id,
    _signer: LocalAccount,
    options: SdkOptions,
  ): Promise<string | null> => {
    // unlike Alchemy, a throwaway-signed call can't be used here:
    // thirdweb sends it when the operator isn't delegated yet
    return this.getDelegationContract(caip2Id, options).then(
      () => null,
      (error: Error) => error.message,
    );
  };
}
