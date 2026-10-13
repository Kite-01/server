import {
  KeyType,
  KeyVars,
  KiteContractEventTopics,
  OneMinute,
  Provider,
} from "../shared/constants";
import { providerDescriptorOfChain } from "../shared/chains";
import { type OnchainNotifier } from "./interfaces/OnchainNotifier";
import { SdkRequestError } from "../shared/errors";
import { type BaseSdk } from "./interfaces/BaseSdk";
import { zeroAddress } from "viem";
import { createHmac } from "node:crypto";
import { KvService } from "../services/Kv.service";
import { common } from "../shared/common";
import { kite } from "../shared/kiteContract";
import { Http } from "./Http";
import { env } from "../shared/env";

export class QuickNode implements OnchainNotifier, BaseSdk {
  getClient = (options: SdkOptions): Http => {
    const apiKey = common.requireVar(options, KeyVars.QuickNodeApiKey);

    return new Http("https://api.quicknode.com", {
      "x-api-key": apiKey,
      "Content-Type": "application/json",
      Accept: "application/json",
    });
  };

  getCallbackUrl = (activity: "addressActivity" | "contractEvent") => {
    return `${env.KITE_PUBLIC_BASE_URL}/callback/${Provider.QuickNode}/${activity}`;
  };

  upsertNotifier = async (
    template: "evmWalletFilter" | "evmContractEvents",
    /**
     * - if `template` is `evmWalletFilter` address is a wallet address (EOA/Smart contract)
     * - if `template` is `evmContractEvents` address is a contract address
     */
    address: string,
    network: string,
    options: SdkOptions,
  ) => {
    const kvService = new KvService();
    const client = this.getClient(options);

    const upsertListItem = async (key: string, items: string[]) => {
      let isNew = false;

      const getListResponse = await client.get<{
        data: { items: Array<string> };
      }>(`/kv/rest/v1/lists${key}`);

      if (!getListResponse.isOk || !getListResponse.data?.data.items.length) {
        const url = "/kv/rest/v1/lists";
        const createListResponse = await client.post(url, {
          key,
          items,
        });

        if (!createListResponse.isOk) {
          throw new SdkRequestError(
            Provider.QuickNode,
            url,
            createListResponse,
          );
        }

        isNew = true;
      }

      if (!isNew) {
        const url = `/kv/rest/v1/lists/${key}/items`;
        const addItemToListResponse = await client.post(url, {
          item: items[0],
        });

        if (!addItemToListResponse.isOk) {
          throw new SdkRequestError(
            Provider.QuickNode,
            url,
            addItemToListResponse,
          );
        }
      }
    };

    let templateArgs;
    let webhookId = common.getVar(
      options,
      template === "evmWalletFilter"
        ? KeyVars.QuickNodeEvmWalletFilter_WebhookId
        : KeyVars.QuickNodeEvmContractEvents_WebhookId,
    );

    if (template === "evmWalletFilter") {
      let walletsListName = common.getVar(
        options,
        KeyVars.QuickNodeEvmWalletFilter_WalletsListName,
      );

      if (!walletsListName) {
        walletsListName = "evmWalletFilterWalletsList";

        await kvService.upsertKv({
          key: KeyVars.QuickNodeEvmWalletFilter_WalletsListName,
          value: walletsListName,
          type: KeyType.String,
        });
      }

      await upsertListItem(walletsListName, [address]);

      templateArgs = { walletsListName };
    }

    if (template === "evmContractEvents") {
      let contractsListName = common.getVar(
        options,
        KeyVars.QuickNodeEvmContractEvents_ContractsListName,
      );

      if (!contractsListName) {
        contractsListName = "evmContractEventsContractsListName";

        await kvService.upsertKv({
          key: KeyVars.QuickNodeEvmContractEvents_ContractsListName,
          value: contractsListName,
          type: KeyType.String,
        });
      }

      await upsertListItem(contractsListName, [address]);

      let eventHashesListName = common.getVar(
        options,
        KeyVars.QuickNodeEvmContractEvents_EventHashesListName,
      );

      if (!eventHashesListName) {
        eventHashesListName = "evmContractEventsEventHashesListName";
        await upsertListItem(eventHashesListName, KiteContractEventTopics);

        await kvService.upsertKv({
          key: KeyVars.QuickNodeEvmContractEvents_EventHashesListName,
          value: eventHashesListName,
          type: KeyType.String,
        });
      }

      templateArgs = { contractsListName, eventHashesListName };
    }

    if (!webhookId) {
      let securityToken = common.getVar(
        options,
        KeyVars.QuickNodeWebhookSecurityToken,
      );

      if (!securityToken) {
        securityToken = common.uuidv4();

        await kvService.upsertKv({
          key: KeyVars.QuickNodeWebhookSecurityToken,
          value: securityToken,
          type: KeyType.SecureString,
        });
      }

      const url = `/webhooks/rest/v1/template/${template}`;
      const response = await client.post<{ id: string }>(url, {
        name:
          template === "evmWalletFilter"
            ? `Track EVM wallet activity (${network})`
            : `Track Kite contract activity (${network})`,
        network,
        destination_attributes: {
          url: this.getCallbackUrl(
            template === "evmWalletFilter"
              ? "addressActivity"
              : "contractEvent",
          ),
          security_token: securityToken,
          compression: "gzip",
          templateArgs,
        },
      });

      if (!response.isOk || !response.data?.id) {
        throw new SdkRequestError(Provider.QuickNode, url, response);
      }

      webhookId = response.data.id;

      await kvService.upsertKv({
        key:
          template === "evmWalletFilter"
            ? KeyVars.QuickNodeEvmWalletFilter_WebhookId
            : KeyVars.QuickNodeEvmContractEvents_WebhookId,
        value: webhookId,
        type: KeyType.String,
      });
    }
  };

  trackAddressActivity = async (
    input: OnchainNotifierTrackAddressActivityInput,
    options: SdkOptions,
  ): Promise<void> => {
    const network = providerDescriptorOfChain<string>(
      input.caip2Id,
      Provider.QuickNode,
    );

    return await this.upsertNotifier(
      "evmWalletFilter",
      common.normalizeAddress(input.address),
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
      Provider.QuickNode,
    );

    return await this.upsertNotifier(
      "evmContractEvents",
      common.normalizeAddress(input.contractAddress),
      network,
      options,
    );
  };

  isValidCallback = async (
    input: OnchainNotifierVerifyCallbackInput,
    options: SdkOptions,
  ): Promise<boolean> => {
    const signature = common.getHeader(input.headers, "x-qn-signature");
    const timestamp = common.getHeader(input.headers, "x-qn-timestamp");
    const nonce = common.getHeader(input.headers, "x-qn-nonce");

    if (!signature || !nonce || !timestamp) {
      return false;
    }

    const timestampMs = common.toMs(Number(timestamp));

    if (
      !Number.isFinite(timestampMs) ||
      Math.abs(Date.now() - timestampMs) > common.toMs(5 * OneMinute)
    ) {
      return false;
    }

    const token = common.requireVar(
      options,
      KeyVars.QuickNodeWebhookSecurityToken,
    );

    const digest = createHmac("sha256", token)
      .update(
        `${nonce}${timestamp}${common.rawBodyToString(input.body, input.rawBody)}`,
        "utf8",
      )
      .digest("hex");

    return common.safeCompare(signature.toLowerCase(), digest.toLowerCase());
  };

  handleCallback = async (
    activity: "addressActivity" | "contractEvent",
    payload: {
      matchingReceipts: Array<{
        status: string;
        transactionHash: string;
        logs: Array<{
          address: string;
          topics: string[];
          data: string;
          logIndex: string;
          transactionHash: string;
        }>;
      }>;
      matchingTransactions: Array<{
        chainId: string;
        from: string;
        to: string;
        hash: string;
        value: string;
      }>;
    },
  ): Promise<OnchainNotifierCallbackResult> => {
    const result: OnchainNotifierCallbackResult = [];

    const transactions = payload.matchingTransactions;
    const receipts = payload.matchingReceipts;

    const receiptByHash = new Map(
      receipts.map((receipt) => [
        receipt.transactionHash.toLowerCase(),
        receipt,
      ]),
    );

    const toCaip2Id = (chainId: string) => {
      return `eip155:${Number.parseInt(chainId, 16)}` as Caip2Id;
    };

    const caip2IdByHash = new Map(
      transactions.map((transaction) => [
        transaction.hash.toLowerCase(),
        toCaip2Id(transaction.chainId),
      ]),
    );

    if (activity === "addressActivity") {
      for (const transaction of transactions) {
        const receipt = receiptByHash.get(transaction.hash.toLowerCase());
        if (receipt?.status !== "0x1") {
          continue;
        }

        const caip2Id = toCaip2Id(transaction.chainId);
        const value = BigInt(transaction.value ?? "0x0");
        const logs = receipt.logs ?? [];

        // in a Kite settle/refund/recover transaction, transfers into the clone are the
        // contract's own (e.g. swap output), not deposits.
        const clones = new Set(
          kite
            .parseContractLogs(caip2Id, logs)
            .map((item) => item.payinAddress.toLowerCase()),
        );

        if (
          transaction.to &&
          !clones.has(transaction.to.toLowerCase()) &&
          value > 0n
        ) {
          result.push({
            type: "DepositReceived",
            caip2Id,
            blockchainHash: transaction.hash,
            logIndex: "native",
            from: common.normalizeAddress(transaction.from),
            payinAddress: common.normalizeAddress(transaction.to),
            tokenAddress: zeroAddress,
            amount: value,
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
            blockchainHash: transaction.hash,
            logIndex: BigInt(log.logIndex).toString(),
            from: erc20Transfer.from,
            payinAddress: erc20Transfer.to,
            tokenAddress: erc20Transfer.token,
            amount: erc20Transfer.amount,
          });
        }
      }
    }

    if (activity === "contractEvent") {
      for (const receipt of receipts) {
        if (receipt.status !== "0x1") {
          continue;
        }

        const hash = receipt.transactionHash;
        const caip2Id = caip2IdByHash.get(hash.toLowerCase());
        if (!caip2Id) {
          continue;
        }

        result.push(...kite.parseContractLogs(caip2Id, receipt.logs));
      }
    }

    return result;
  };
}
