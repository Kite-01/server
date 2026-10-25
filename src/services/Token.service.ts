import {
  type Address,
  type Hex,
  erc20Abi,
  getAddress,
  isAddress,
  parseAbi,
} from "viem";
import {
  paginate,
  searchPattern,
  type WithPageInput,
} from "../shared/pagination";
import { AppError, NotFoundError, PreconditionError } from "../shared/errors";
import { and, eq, desc, count, ilike, or, isNull } from "drizzle-orm";
import { getChain } from "../shared/chains";
import { Provider, zeroBytes32 } from "../shared/constants";
import { getOnchainActor } from "../shared/onchainActor";
import { ChainService } from "./Chain.service";
import { common } from "../shared/common";
import { chainConfig, token } from "../db/schema";
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
        isNull(token.deletedAt),
      ),
    });
  };

  getTokenByAddress = async (
    chainId: string,
    tokenAddress: string,
    { listed = false }: { listed?: boolean } = {},
  ) => {
    const row = await this.findOrCreateToken(chainId, tokenAddress);
    if (!listed || row.listed) return row;

    await db.update(token).set({ listed: true }).where(eq(token.id, row.id));
    return { ...row, listed: true };
  };

  private findOrCreateToken = async (chainId: string, tokenAddress: string) => {
    const address = common.normalizeAddress(tokenAddress);
    const row = await this.findTokenByAddress(chainId, address);

    if (row) return row;

    const chain = await new ChainService().getChainById(chainId);
    if (!chain) throw new NotFoundError("chain", chainId);

    const saveToken = async (values: typeof token.$inferInsert) => {
      await db
        .insert(token)
        .values(values)
        .onConflictDoNothing({
          target: [token.chainId, token.address],
          where: isNull(token.deletedAt),
        });

      const row = await this.findTokenByAddress(values.chainId, values.address);
      if (!row) throw new AppError("Could not save token");
      return row;
    };

    const TWAssetsUrl =
      "https://cdn.jsdelivr.net/gh/trustwallet/assets@master/blockchains";
    const http = new Http(TWAssetsUrl);
    const chain_ = getChain(chain.caip2Id);
    const descriptor = chain_.descriptors?.[Provider.TrustWallet] as
      string | undefined;

    if (common.isZeroAddress(address)) {
      return saveToken({
        chainId,
        address,
        symbol: chain_.nativeCurrency.symbol,
        decimals: chain_.nativeCurrency.decimals,
        name: chain_.nativeCurrency.name,
        supportsEIP3009: false,
        icon: descriptor ? `${TWAssetsUrl}/${descriptor}/info/logo.png` : null,
      });
    }

    const domain = await this.readTokenDomain(chain.caip2Id, address);
    const supportsEIP3009 = !!domain;
    const version = domain?.version;

    if (descriptor) {
      const tokenBaseUrl = `/${descriptor}/assets/${address}`;
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
          icon: `${TWAssetsUrl}${tokenBaseUrl}/logo.png`,
        });
      }
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
      where: and(eq(token.id, tokenId), isNull(token.deletedAt)),
      with: { chain: true },
    });
  };

  getTokens = async (
    input: WithPageInput<{
      chainId?: string;
      q?: string;
    }>,
  ) => {
    const pattern = input.q ? searchPattern(input.q) : undefined;
    const where = and(
      isNull(token.deletedAt),
      eq(token.listed, true),
      input.chainId ? eq(token.chainId, input.chainId) : undefined,
      pattern
        ? or(
            ilike(token.symbol, pattern),
            ilike(token.name, pattern),
            ilike(token.address, pattern),
          )
        : undefined,
    );

    return paginate(
      input,
      (limit, offset) => {
        return db.query.token.findMany({
          where,
          orderBy: desc(token.createdAt),
          limit,
          offset,
          with: { chain: true },
        });
      },
      async () => {
        const [row] = await db
          .select({ value: count() })
          .from(token)
          .where(where);

        return row.value;
      },
    );
  };

  deleteToken = async (tokenId: string) => {
    const result = await db
      .select({ count: count() })
      .from(chainConfig)
      .where(
        or(
          eq(chainConfig.settlementTokenId, tokenId),
          eq(chainConfig.usdPeggedTokenId, tokenId),
        ),
      );

    if (result[0].count > 0)
      throw new PreconditionError("Token is in use by a chain's configuration");

    const [row] = await db
      .update(token)
      .set({ deletedAt: new Date() })
      .where(and(eq(token.id, tokenId), isNull(token.deletedAt)))
      .returning();

    return row;
  };

  getTokensByChainId = async (chainId: string) => {
    return await db.query.token.findMany({
      where: and(
        eq(token.chainId, chainId),
        eq(token.listed, true),
        isNull(token.deletedAt),
      ),
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
