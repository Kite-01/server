import { type Address, erc20Abi, type Hex, parseAbi } from "viem";
import { AppError, NotFoundError } from "../shared/errors";
import { type ChainService } from "./Chain.service";
import { getOnchainActor } from "../shared/onchainActor";
import { and, eq, desc } from "drizzle-orm";
import { Provider, zeroBytes32 } from "../shared/constants";
import { getChain, providerDescriptorOfChain } from "../shared/chains";
import { common } from "../shared/common";
import { token } from "../db/schema";
import { Http } from "../sdks/Http";
import { db } from "../db";

export class TokenService {
  constructor(private readonly chainService: ChainService) {}

  getTokenByAddress = async (chainId: string, tokenAddress: string) => {
    const address = common.normalizeAddress(tokenAddress);
    const row = await db.query.token.findFirst({
      where: and(eq(token.chainId, chainId), eq(token.address, address)),
      with: { chain: true },
    });

    if (row) return row;

    const chain = await this.chainService.getChainById(chainId);
    if (!chain) throw new NotFoundError("chain", chainId);

    const baseUrl =
      "https://cdn.jsdelivr.net/gh/trustwallet/assets@master/blockchains";
    const http = new Http(baseUrl);

    const descriptor = providerDescriptorOfChain<string>(
      chain.caip2Id,
      Provider.TrustWallet,
    );

    const chainBaseUrl = `/${descriptor}`;

    if (common.isZeroAddress(tokenAddress)) {
      const chain_ = getChain(chain.caip2Id);
      const [row] = await db
        .insert(token)
        .values({
          chainId,
          address,
          symbol: chain_.nativeCurrency.symbol,
          decimals: chain_.nativeCurrency.decimals,
          name: chain_.nativeCurrency.name,
          supportsEIP3009: false,
          icon: `${chainBaseUrl}/info/logo.png`,
        })
        .returning();

      return row;
    }

    const supportsEIP3009 = !!(await this.readTokenDomain(
      chain.caip2Id,
      tokenAddress,
    ));

    const tokenBaseUrl = `${chainBaseUrl}/assets/${address}`;
    const iconUrl = `${tokenBaseUrl}/logo.png`;

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
      const [row] = await db
        .insert(token)
        .values({
          chainId,
          address,
          symbol: response.data.symbol,
          decimals: response.data.decimals,
          name: response.data.name,
          supportsEIP3009,
          icon: iconUrl,
        })
        .returning();

      return row;
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

    const [row2] = await db
      .insert(token)
      .values({
        chainId,
        address: tokenAddress,
        symbol,
        decimals,
        name,
        supportsEIP3009,
      })
      .returning();

    return row2;
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
}
