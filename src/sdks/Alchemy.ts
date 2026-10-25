import {
  alchemyWalletTransport,
  createSmartWalletClient,
} from "@alchemy/wallet-apis";
import {
  getChain,
  getSupportedChains,
  getViemChain,
  providerDescriptorOfChain,
} from "../shared/chains";
import { type Address, type Hex, type LocalAccount, zeroAddress } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import {
  KeyType,
  KeyVarPrefix,
  KeyVars,
  networkKeyVar,
  Provider,
} from "../shared/constants";
import { type OnchainNotifier } from "./interfaces/OnchainNotifier";
import { type GasSponsor } from "./interfaces/GasSponsor";
import { getOnchainActor } from "../shared/onchainActor";
import { SdkRequestError } from "../shared/errors";
import { createHmac } from "node:crypto";
import { KvService } from "../services/Kv.service";
import { common } from "../shared/common";
import { kite } from "../shared/kiteContract";
import { Http } from "./Http";
import { env } from "../shared/env";

type Activity = "addressActivity" | "contractEvent";

type Webhook = { id: string; signingKey: string };

export class Alchemy implements GasSponsor, OnchainNotifier {
  private getClient = (
    caip2Id: Caip2Id,
    signer: LocalAccount,
    options: SdkOptions,
    account?: Address,
  ) => {
    return createSmartWalletClient({
      transport: alchemyWalletTransport({
        apiKey: common.requireVar(options, KeyVars.AlchemyApiKey),
      }),
      chain: getViemChain(caip2Id),
      signer,
      account,
      paymaster: {
        policyId: common.requireVar(options, KeyVars.AlchemyGasPolicyId),
      },
    });
  };

  submitSponsoredCalls = async (
    input: OnchainActorTransactionInput,
    signer: LocalAccount,
    options: SdkOptions,
  ): Promise<{ callId: string }> => {
    const client = this.getClient(input.caip2Id, signer, options);
    const call = await client.sendCalls({
      calls: [
        {
          to: input.to as Address,
          data: input.data as Hex | undefined,
          value: input.value,
        },
      ],
    });

    return { callId: call.id };
  };

  getSponsoredCallsStatus = async (
    caip2Id: Caip2Id,
    callId: string,
    signer: LocalAccount,
    options: SdkOptions,
  ): Promise<OnchainActorCallStatus> => {
    const client = this.getClient(caip2Id, signer, options);
    const result = await client.getCallsStatus({
      id: callId,
    });

    const transactionHash = result.receipts?.[0]?.transactionHash;
    if (result.status === "success" && transactionHash) {
      return {
        status: "success",
        transactionHash,
      };
    }

    if (result.status === "failure") {
      return {
        status: "failure",
        transactionHash,
      };
    }

    return {
      status: "pending",
    };
  };

  getSponsorshipError = async (
    caip2Id: Caip2Id,
    signer: LocalAccount,
    options: SdkOptions,
  ): Promise<string | null> => {
    // signed by a throwaway key so it can never execute;
    // Alchemy checks the chain, EIP-7702 and the gas policy first, then refuses the signature
    const client = this.getClient(
      caip2Id,
      privateKeyToAccount(generatePrivateKey()),
      options,
      signer.address,
    );

    const error = await client.sendCalls({ calls: [{ to: zeroAddress }] }).then(
      () => null,
      (error: { code?: number; details?: string; message: string }) => error,
    );

    if (!error) return null;

    const reason = error.details ?? error.message;
    const signatureRefused =
      error.code === -32507 || reason.includes("recovered authority mismatch");

    return signatureRefused ? null : reason;
  };

  getNotifyClient = (options: SdkOptions): Http => {
    const authToken = common.requireVar(options, KeyVars.AlchemyAuthToken);

    return new Http("https://dashboard.alchemy.com/api", {
      "X-Alchemy-Token": authToken,
      "Content-Type": "application/json",
      Accept: "application/json",
    });
  };

  getCallbackUrl = (activity: Activity) => {
    return `${env.KITE_PUBLIC_BASE_URL}/callback/${Provider.Alchemy}/${activity}`;
  };

  upsertNotifier = async (
    activity: Activity,
    address: string,
    network: string,
    options: SdkOptions,
  ) => {
    const client = this.getNotifyClient(options);
    const kvService = new KvService();
    const key = networkKeyVar(
      activity === "addressActivity"
        ? KeyVarPrefix.AlchemyAddressActivity_Webhook
        : KeyVarPrefix.AlchemyContractEvents_Webhook,
      network,
    );

    const addAddress = async (webhook: Webhook) => {
      const url = "/update-webhook-addresses";
      const response = await client.patch(url, {
        webhook_id: webhook.id,
        addresses_to_add: [address],
        addresses_to_remove: [],
      });

      if (!response.isOk) {
        throw new SdkRequestError(Provider.Alchemy, url, response);
      }
    };

    const known = this.webhook(common.getVar(options, key));
    if (known) return addAddress(known);

    await kvService.withLock(key, async () => {
      const stored = this.webhook((await kvService.getKv(key))?.value ?? null);
      if (stored) return addAddress(stored);

      const url = "/create-webhook";
      const response = await client.post<{
        data: { id: string; signing_key: string };
      }>(url, {
        network,
        webhook_type: "ADDRESS_ACTIVITY",
        webhook_url: this.getCallbackUrl(activity),
        name:
          activity === "addressActivity"
            ? `Track EVM wallet activity (${network})`
            : `Track Kite contract activity (${network})`,
        addresses: [address],
      });

      if (!response.isOk || !response.data?.data?.id) {
        throw new SdkRequestError(Provider.Alchemy, url, response);
      }

      await kvService.upsertKv({
        key,
        value: JSON.stringify({
          id: response.data.data.id,
          signingKey: response.data.data.signing_key,
        }),
        type: KeyType.SecureString,
      });
    });
  };

  private webhook = (value: string | null): Webhook | null => {
    try {
      const parsed = JSON.parse(value ?? "null");
      return typeof parsed?.id === "string" &&
        typeof parsed.signingKey === "string"
        ? parsed
        : null;
    } catch {
      return null;
    }
  };

  trackAddressActivity = async (
    input: OnchainNotifierTrackAddressActivityInput,
    options: SdkOptions,
  ): Promise<void> => {
    const network = providerDescriptorOfChain<string>(
      input.caip2Id,
      Provider.Alchemy,
    );

    return await this.upsertNotifier(
      "addressActivity",
      common.normalizeAddress(input.address).toLowerCase(),
      network,
      options,
    );
  };

  trackKiteContractEvent = async (
    input: OnchainNotifierTrackContractEventInput,
    options: SdkOptions,
  ): Promise<void> => {
    const network = providerDescriptorOfChain<string>(
      input.caip2Id,
      Provider.Alchemy,
    );

    return await this.upsertNotifier(
      "contractEvent",
      common.normalizeAddress(input.contractAddress).toLowerCase(),
      network,
      options,
    );
  };

  isValidCallback = async (
    input: OnchainNotifierVerifyCallbackInput,
    options: SdkOptions,
  ): Promise<boolean> => {
    const signature = common.getHeader(input.headers, "x-alchemy-signature");
    const webhookId = (input.body as { webhookId?: unknown } | null)?.webhookId;

    if (!signature || typeof webhookId !== "string") {
      return false;
    }

    const prefixes = [
      KeyVarPrefix.AlchemyAddressActivity_Webhook,
      KeyVarPrefix.AlchemyContractEvents_Webhook,
    ].map((prefix) => `${prefix}:`);

    const webhook = Object.entries(options.variables)
      .filter(([key]) => prefixes.some((prefix) => key.startsWith(prefix)))
      .map(([, value]) => this.webhook(value))
      .find((item) => item?.id === webhookId);

    if (!webhook) {
      return false;
    }

    const digest = createHmac("sha256", webhook.signingKey)
      .update(common.rawBodyToString(input.body, input.rawBody), "utf8")
      .digest("hex");

    return common.safeCompare(signature.toLowerCase(), digest.toLowerCase());
  };

  handleCallback = async (
    activity: Activity,
    payload: {
      event: {
        network: string;
        activity: Array<{ hash: string }>;
      };
    },
  ): Promise<OnchainNotifierCallbackResult> => {
    const result: OnchainNotifierCallbackResult = [];

    const caip2Id = getSupportedChains().find(
      (chain) =>
        chain.descriptors?.[Provider.Alchemy] === payload.event.network,
    )?.caip2Id;

    if (!caip2Id) {
      return result;
    }

    const client = await getOnchainActor(getChain(caip2Id).type).publicClient(
      caip2Id,
    );

    const hashes = new Set(
      payload.event.activity.map((item) => item.hash.toLowerCase() as Hex),
    );

    for (const hash of hashes) {
      const [transaction, receipt] = await Promise.all([
        client.getTransaction({ hash }),
        client.getTransactionReceipt({ hash }),
      ]);

      if (receipt.status !== "success") {
        continue;
      }

      const logs = receipt.logs.map((log) => ({
        ...log,
        logIndex: String(log.logIndex),
        transactionHash: log.transactionHash ?? receipt.transactionHash,
      }));

      if (activity === "contractEvent") {
        result.push(...kite.parseContractLogs(caip2Id, logs));
        continue;
      }

      const clones = new Set(
        kite
          .parseContractLogs(caip2Id, logs)
          .map((item) => item.payinAddress.toLowerCase()),
      );

      if (
        transaction.to &&
        !clones.has(transaction.to.toLowerCase()) &&
        transaction.value > 0n
      ) {
        result.push({
          type: "DepositReceived",
          caip2Id,
          blockchainHash: hash,
          logIndex: "native",
          from: common.normalizeAddress(transaction.from),
          payinAddress: common.normalizeAddress(transaction.to),
          tokenAddress: zeroAddress,
          amount: transaction.value,
        });
      }

      for (const log of logs) {
        const erc20Transfer = kite.parseErc20TransferLog(log);
        if (
          !erc20Transfer ||
          erc20Transfer.amount === 0n ||
          clones.has(erc20Transfer.to.toLowerCase())
        ) {
          continue;
        }

        result.push({
          type: "DepositReceived",
          caip2Id,
          blockchainHash: hash,
          logIndex: BigInt(log.logIndex).toString(),
          from: erc20Transfer.from,
          payinAddress: erc20Transfer.to,
          tokenAddress: erc20Transfer.token,
          amount: erc20Transfer.amount,
        });
      }
    }

    return result;
  };
}
