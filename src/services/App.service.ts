import {
  paginate,
  searchPattern,
  type WithPageInput,
} from "../shared/pagination";
import { and, asc, eq, isNull, desc, count, ilike } from "drizzle-orm";
import { app, appChain, chain as chainTable } from "../db/schema";
import { AppError, NotFoundError } from "../shared/errors";
import { PayoutService } from "./Payout.service";
import { ChainService } from "./Chain.service";
import { isAddress } from "viem";
import { common } from "../shared/common";
import { db } from "../db";

type PayoutFields = Partial<
  Pick<typeof app.$inferInsert, "payoutAsset" | "payoutAddress">
>;

export class AppService {
  private assertPayout = async (
    input: PayoutFields,
    current?: PayoutFields,
  ) => {
    if (input.payoutAsset === undefined && input.payoutAddress === undefined) {
      return;
    }

    const payoutAsset =
      input.payoutAsset !== undefined
        ? input.payoutAsset
        : (current?.payoutAsset ?? null);
    const payoutAddress =
      input.payoutAddress !== undefined
        ? input.payoutAddress
        : (current?.payoutAddress ?? null);

    if (!payoutAsset && !payoutAddress) return;
    if (!payoutAsset || !payoutAddress) {
      throw new AppError(
        "Set both the payout token and the payout address, or neither",
      );
    }

    await new PayoutService().validateDestination(payoutAsset, payoutAddress);
  };

  createApp = async (input: typeof app.$inferInsert) => {
    await this.assertPayout(input);

    const [row] = await db.insert(app).values(input).returning();
    return row;
  };

  updateApp = async (
    appId: string,
    update: Partial<
      Pick<
        typeof app.$inferInsert,
        | "name"
        | "icon"
        | "websiteUrl"
        | "termsOfServiceUrl"
        | "privacyPolicyUrl"
        | "payoutAsset"
        | "payoutAddress"
      >
    >,
  ) => {
    const current = await this.getApp(appId);
    if (!current) return undefined;

    await this.assertPayout(update, current);

    const [row] = await db
      .update(app)
      .set(update)
      .where(and(eq(app.id, appId), isNull(app.deletedAt)))
      .returning();

    return row;
  };

  deleteApp = async (appId: string) => {
    const [row] = await db
      .update(app)
      .set({ deletedAt: new Date() })
      .where(and(eq(app.id, appId), isNull(app.deletedAt)))
      .returning();

    return row;
  };

  doesAppExist = async (appId: string) => {
    const result = await db
      .select({ count: count() })
      .from(app)
      .where(eq(app.id, appId));

    return result[0].count > 0;
  };

  getApp = async (appId: string) => {
    return db.query.app.findFirst({
      where: and(eq(app.id, appId), isNull(app.deletedAt)),
    });
  };

  getApps = async (
    input: WithPageInput<{
      q?: string;
    }>,
  ) => {
    const where = and(
      isNull(app.deletedAt),
      input.q ? ilike(app.name, searchPattern(input.q)) : undefined,
    );

    return paginate(
      input,
      (limit, offset) => {
        return db.query.app.findMany({
          where,
          orderBy: desc(app.createdAt),
          limit,
          offset,
        });
      },
      async () => {
        const [row] = await db
          .select({ value: count() })
          .from(app)
          .where(where);
        return row.value;
      },
    );
  };

  getChains = async (appId: string) => {
    return db
      .select({
        chainId: appChain.chainId,
        address: appChain.address,
        createdAt: appChain.createdAt,
        updatedAt: appChain.updatedAt,
      })
      .from(appChain)
      .innerJoin(chainTable, eq(chainTable.id, appChain.chainId))
      .where(and(eq(appChain.appId, appId), isNull(chainTable.deletedAt)))
      .orderBy(asc(appChain.createdAt));
  };

  getChainIds = async (appId: string) => {
    const rows = await this.getChains(appId);
    return new Set(rows.map((row) => row.chainId));
  };

  getChainAddress = async (appId: string, chainId: string) => {
    const row = await db.query.appChain.findFirst({
      where: and(eq(appChain.appId, appId), eq(appChain.chainId, chainId)),
      columns: { address: true },
    });

    return row?.address ?? null;
  };

  setChain = async (appId: string, chainId: string, address: string) => {
    if (!isAddress(address)) {
      throw new AppError("The address is not a valid address");
    }

    const chain = await new ChainService().getChainById(chainId);
    if (!chain) throw new NotFoundError("chain", chainId);
    if (!chain.config) throw new AppError("This chain is not configured yet");

    const normalized = common.normalizeAddress(address);
    const [row] = await db
      .insert(appChain)
      .values({ appId, chainId, address: normalized })
      .onConflictDoUpdate({
        target: [appChain.appId, appChain.chainId],
        set: { address: normalized, updatedAt: new Date() },
      })
      .returning({
        chainId: appChain.chainId,
        address: appChain.address,
        createdAt: appChain.createdAt,
        updatedAt: appChain.updatedAt,
      });

    return row;
  };

  removeChain = async (appId: string, chainId: string) => {
    const [row] = await db
      .delete(appChain)
      .where(and(eq(appChain.appId, appId), eq(appChain.chainId, chainId)))
      .returning({
        chainId: appChain.chainId,
        address: appChain.address,
        createdAt: appChain.createdAt,
        updatedAt: appChain.updatedAt,
      });

    return row;
  };
}
