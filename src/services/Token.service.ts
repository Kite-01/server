import {
  type Address,
  type Hex,
  erc20Abi,
  getAddress,
  isAddress,
  parseAbi,
} from "viem";
import { getChain, providerDescriptorOfChain } from "../shared/chains";
import { AppError, NotFoundError } from "../shared/errors";
import { Provider, zeroBytes32 } from "../shared/constants";
import { getOnchainActor } from "../shared/onchainActor";
import { and, eq, desc } from "drizzle-orm";
import { ChainService } from "./Chain.service";
import { common } from "../shared/common";
import { token } from "../db/schema";
import { Http } from "../sdks/Http";
import { db } from "../db";

export class TokenService {
  findTokenByAddress = async (chainId: string, tokenAddress: string) => {
    if (!isAddress(tokenAddress, { strict: false })) {
      return undefined;
    }

    return db.query.token.findFirst({
      with: { chain: true },
      where: and(
        eq(token.chainId, chainId),
        eq(token.address, getAddress(tokenAddress)),
      ),
    });
  };

  getTokenByAddress = async (chainId: string, tokenAddress: string) => {
    const address = common.normalizeAddress(tokenAddress);
    const row = await this.findTokenByAddress(chainId, address);

    if (row) return row;

    const chain = await new ChainService().getChainById(chainId);
    if (!chain) throw new NotFoundError("chain", chainId);

    const saveToken = async (values: typeof token.$inferInsert) => {
      await db
        .insert(token)
        .values(values)
        .onConflictDoNothing({ target: [token.chainId, token.address] });

      const row = await this.findTokenByAddress(values.chainId, values.address);
      if (!row) throw new AppError("Could not save token");
      return row;
    };

    const TWAssetsUrl =
      "https://cdn.jsdelivr.net/gh/trustwallet/assets@master/blockchains";
    const http = new Http(TWAssetsUrl);
    const descriptor = providerDescriptorOfChain<string>(
      chain.caip2Id,
      Provider.TrustWallet,
    );

    const chainBaseUrl = `/${descriptor}`;

    if (common.isZeroAddress(address)) {
      const chain_ = getChain(chain.caip2Id);
      return saveToken({
        chainId,
        address,
        symbol: chain_.nativeCurrency.symbol,
        decimals: chain_.nativeCurrency.decimals,
        name: chain_.nativeCurrency.name,
        supportsEIP3009: false,
        icon: `${TWAssetsUrl}${chainBaseUrl}/info/logo.png`,
      });
    }

    const domain = await this.readTokenDomain(chain.caip2Id, address);
    const supportsEIP3009 = !!domain;
    const version = domain?.version;

    const tokenBaseUrl = `${chainBaseUrl}/assets/${address}`;
    const iconUrl = `${TWAssetsUrl}${tokenBaseUrl}/logo.png`;

    const response = await http.get<{
      name: string;
      type: string;
      symbol: string;
      decimals: number;
      description: string;
      website: string;
      explorer: string;
      status: string;
      id: string;
      links: Array<{ name: string; url: string }>;
      tags: Array<string>;
    }>(`${tokenBaseUrl}/info.json`);

    if (response.isOk && !!response.data) {
      return saveToken({
        chainId,
        address,
        symbol: response.data.symbol,
        decimals: response.data.decimals,
        name: response.data.name,
        version,
        supportsEIP3009,
        icon: iconUrl,
      });
    }

    const onchainActor = getOnchainActor(getChain(chain.caip2Id).type);
    const client = await onchainActor.publicClient(
      chain.caip2Id,
      chain.config?.rpcUrls ?? [],
    );

    const [name_, symbol_, decimals_] = await client.multicall({
      allowFailure: true,
      contracts: [
        { address, abi: erc20Abi, functionName: "name" },
        { address, abi: erc20Abi, functionName: "symbol" },
        { address, abi: erc20Abi, functionName: "decimals" },
      ],
    });

    const name = name_.result,
      symbol = symbol_.result,
      decimals = decimals_.result;

    if (
      typeof name !== "string" ||
      typeof symbol !== "string" ||
      typeof decimals !== "number"
    ) {
      throw new AppError("Could not get meta information for token");
    }

    return saveToken({
      chainId,
      address,
      symbol,
      decimals,
      name,
      version,
      supportsEIP3009,
    });
  };

  getTokenById = async (tokenId: string) => {
    return await db.query.token.findFirst({
      where: eq(token.id, tokenId),
      with: { chain: true },
    });
  };

  getTokensByChainId = async (chainId: string) => {
    return await db.query.token.findMany({
      where: eq(token.chainId, chainId),
      orderBy: desc(token.createdAt),
      with: { chain: true },
    });
  };

  readTokenDomain = async (
    caip2Id: Caip2Id,
    tokenAddress: string,
    payer?: string,
    nonce?: string,
  ) => {
    const onchainActor = getOnchainActor(getChain(caip2Id).type);
    if (!payer) payer = onchainActor.getAddress();
    if (!nonce) nonce = zeroBytes32;

    const address = tokenAddress as Address;
    const abi = parseAbi([
      "function name() view returns (string)",
      "function version() view returns (string)",
      "function authorizationState(address authorizer, bytes32 nonce) view returns (bool)",
    ]);

    const client = await onchainActor.publicClient(caip2Id);
    const [name_, version_, authorizationStatus_] = await client.multicall({
      allowFailure: true,
      contracts: [
        { address, abi, functionName: "name" },
        { address, abi, functionName: "version" },
        {
          address,
          abi,
          functionName: "authorizationState",
          args: [payer as Address, nonce as Hex],
        },
      ],
    });

    const name = name_.result,
      version = version_.result,
      authorizationStatus = authorizationStatus_.result;

    if (
      typeof name !== "string" ||
      typeof version !== "string" ||
      typeof authorizationStatus !== "boolean"
    ) {
      return null;
    }

    return { name, version };
  };

  isAuthorizationUsed = async (
    caip2Id: Caip2Id,
    tokenAddress: string,
    payer: string,
    nonce: string,
  ) => {
    const onchainActor = getOnchainActor(getChain(caip2Id).type);
    const client = await onchainActor.publicClient(caip2Id);
    const abi = parseAbi([
      "function authorizationState(address authorizer, bytes32 nonce) view returns (bool)",
    ]);

    try {
      return await client.readContract({
        abi,
        address: tokenAddress as Address,
        functionName: "authorizationState",
        args: [payer as Address, nonce as Hex],
      });
    } catch {
      return null;
    }
  };
}
