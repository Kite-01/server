import { and, eq, isNull, or } from "drizzle-orm";
import { FeeType } from "../shared/constants";
import { common } from "../shared/common";
import { fee } from "../db/schema";
import { db } from "../db";

type Scalar = string | number | boolean;

type EqIn<T> = {
  _eq?: T;
  _in?: T[];
};

type FeeMatchContext = {
  customer: Maybe<{
    id: string;
    traits: Maybe<Record<string, unknown>>;
  }>;
  sourceAmount: bigint;
  sourceToken: {
    address: string;
  };
  targetToken: {
    address: string;
  };
};

export class FeeService {
  createFee = async (input: typeof fee.$inferInsert) => {
    const [row] = await db.insert(fee).values(input).returning();
    return row;
  };

  getFees = async (appId: string) => {
    return db.query.fee.findMany({
      where: or(eq(fee.appId, appId), isNull(fee.appId)),
      with: { chain: true },
    });
  };

  getFeesByChainId = async (appId: string, chainId: string) => {
    return db.query.fee.findMany({
      with: { chain: true },
      where: and(
        eq(fee.chainId, chainId),
        or(eq(fee.appId, appId), isNull(fee.appId)),
      ),
    });
  };

  getFee = async (appId: string, feeId: string) => {
    return db.query.fee.findFirst({
      where: and(eq(fee.id, feeId), eq(fee.appId, appId)),
      with: { chain: true },
    });
  };

  updateFee = async (
    appId: string,
    feeId: string,
    input: Partial<Omit<typeof fee.$inferInsert, "appId">>,
  ) => {
    await db
      .update(fee)
      .set(input)
      .where(and(eq(fee.id, feeId), eq(fee.appId, appId)));
  };

  deleteFee = async (appId: string, feeId: string) => {
    await db.delete(fee).where(and(eq(fee.id, feeId), eq(fee.appId, appId)));
  };

  matchesCondition = (condition: Record<string, any>, ctx: FeeMatchContext) => {
    const matchAmount = (
      filter: Record<string, string | undefined>,
      actual: bigint,
    ) => {
      const AmountOps: Record<string, (a: bigint, b: bigint) => boolean> = {
        _eq: (a, b) => a === b,
        _gt: (a, b) => a > b,
        _gte: (a, b) => a >= b,
        _lt: (a, b) => a < b,
        _lte: (a, b) => a <= b,
      };

      return Object.entries(filter).every(([op, raw]) => {
        if (raw === undefined) {
          return true;
        }

        const cmp = AmountOps[op];
        return cmp ? cmp(actual, BigInt(raw)) : false;
      });
    };

    const getPath = (obj: unknown, path: string[]) => {
      return path.reduce<unknown>(
        (acc, key) =>
          acc && typeof acc === "object"
            ? (acc as Record<string, unknown>)[key]
            : undefined,
        obj,
      );
    };

    const matchEqIn = <T>(
      actual: T | undefined,
      filter: EqIn<T>,
      same: (a: T, b: T) => boolean = (a, b) => a === b,
    ): boolean => {
      if (actual === undefined) {
        return false;
      }

      const keys = Object.keys(filter);

      if (keys.some((k) => k !== "_eq" && k !== "_in")) {
        // unknown op
        return false;
      }

      if (filter._eq !== undefined && !same(actual, filter._eq)) {
        return false;
      }

      if (
        filter._in !== undefined &&
        !filter._in.some((v) => same(actual, v))
      ) {
        return false;
      }

      return true;
    };

    const matchCustomer = (
      filter: Record<string, EqIn<Scalar>>,
      customer: FeeMatchContext["customer"],
    ) => {
      if (!customer) {
        return false;
      }

      return Object.entries(filter).every(([key, f]) => {
        if (!f) {
          return true;
        }

        const actual =
          key === "id"
            ? customer.id
            : key.startsWith("traits.")
              ? getPath(customer.traits, key.slice("traits.".length).split("."))
              : undefined;

        return matchEqIn(actual as Scalar | undefined, f);
      });
    };

    const matchCurrency = (
      filter: Record<string, EqIn<string>>,
      tokenAddress: string,
    ) => {
      return Object.entries(filter).every(([key, f]) => {
        if (!f) return true;
        switch (key) {
          case "contractAddress":
            return matchEqIn(
              tokenAddress,
              f,
              (a, b) => a.toLowerCase() === b.toLowerCase(),
            );

          default:
            return false;
        }
      });
    };

    if (
      condition.customer &&
      !matchCustomer(condition.customer, ctx.customer)
    ) {
      return false;
    }

    if (
      condition.sourceCurrency &&
      !matchCurrency(condition.sourceCurrency, ctx.sourceToken.address)
    ) {
      return false;
    }

    if (
      condition.sourceAmount &&
      !matchAmount(condition.sourceAmount, ctx.sourceAmount)
    ) {
      return false;
    }

    if (
      condition.targetCurrency &&
      !matchCurrency(condition.targetCurrency, ctx.targetToken.address)
    ) {
      return false;
    }

    return true;
  };

  getMatchingFees = async (
    appId: string,
    chainId: string,
    ctx: FeeMatchContext,
  ) => {
    const fees = await this.getFeesByChainId(appId, chainId);
    return fees.filter((fee) => this.matchesCondition(fee.condition, ctx));
  };

  computeFeeAmount = (f: typeof fee.$inferSelect, base: bigint) => {
    let amount =
      f.type === FeeType.Variable
        ? common.ceilDiv(base * f.value, 10000n)
        : f.value;

    if (f.minAmountToCharge !== null && amount < f.minAmountToCharge)
      amount = f.minAmountToCharge;
    if (f.maxAmountToCharge !== null && amount > f.maxAmountToCharge)
      amount = f.maxAmountToCharge;

    return amount;
  };
}
