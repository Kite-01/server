import { OneDay, TransferStatus } from "../shared/constants";
import { getSupportedChains } from "../shared/chains";
import { AppError } from "../shared/errors";
import { common } from "../shared/common";
import { sql } from "drizzle-orm";
import { db } from "../db";

export type StatsInput = {
  rank?: "volume" | "value";
  timeZone?: string;
  appId?: string;
  from: Date;
  to: Date;
};

const DayMs = common.toMs(OneDay);
const MaxRangeDays = 400;

export class StatsService {
  getStats = async (input: StatsInput) => {
    const percentChange = (current: number, previous: number) => {
      return previous === 0 ? null : ((current - previous) / previous) * 100;
    };

    const validateTimeZone = (timeZone: string) => {
      try {
        new Intl.DateTimeFormat("en", { timeZone });
      } catch {
        throw new AppError(`Unknown time zone "${timeZone}"`);
      }
    };

    const timeZone = input.timeZone ?? "UTC";
    const from = input.from;
    const to = input.to;

    validateTimeZone(timeZone);

    const span = to.getTime() - from.getTime();
    if (!(span > 0)) throw new AppError('"from" must be before "to"');
    if (span > MaxRangeDays * DayMs)
      throw new AppError(`Date range cannot exceed ${MaxRangeDays} days`);

    const previousFrom = new Date(from.getTime() - span);
    const unit = sql.raw(span <= 2 * DayMs ? "'hour'" : "'day'");
    const rank = input.rank ?? "value";

    const transferApp = input.appId
      ? sql`and t.app_id = ${input.appId}`
      : sql``;
    const customerApp = input.appId
      ? sql`where app_id = ${input.appId}`
      : sql``;

    const settledIn = (start: Date, end: Date) => {
      return sql`
        t.status = ${TransferStatus.Settled}
        and t.created_at >= ${start.toISOString()}::timestamptz
        and t.created_at < ${end.toISOString()}::timestamptz
        ${transferApp}
      `;
    };

    const [[current], [previous], [customers], series, topTokens] =
      await Promise.all([
        db.execute<{ amount: string; count: string }>(
          sql`
            select coalesce(sum(q.target_usd_amount), 0)::text as amount, count(*)::text as count
            from kite_transfer t join kite_quote q on q.id = t.quote_id
            where ${settledIn(from, to)}
        `,
        ),
        db.execute<{ amount: string }>(
          sql`
            select coalesce(sum(q.target_usd_amount), 0)::text as amount
            from kite_transfer t join kite_quote q on q.id = t.quote_id
            where ${settledIn(previousFrom, from)}
          `,
        ),
        db.execute<{ total: string; before: string }>(
          sql`
            select
              count(*) filter (where created_at < ${to.toISOString()}::timestamptz)::text as total,
              count(*) filter (where created_at < ${from.toISOString()}::timestamptz)::text as before
            from kite_customer ${customerApp}
          `,
        ),
        db.execute<{
          bucket: string;
          amount: string;
          count: string;
        }>(
          sql`
            with buckets as (
              select generate_series(
                date_trunc(${unit}, ${from.toISOString()}::timestamptz at time zone ${timeZone}),
                date_trunc(${unit}, (${to.toISOString()}::timestamptz - interval '1 microsecond') at time zone ${timeZone}),
                ('1 ' || ${unit})::interval
              ) as bucket
            )
            select
              to_char(b.bucket, 'YYYY-MM-DD"T"HH24:MI:SS') as bucket,
              coalesce(sum(q.target_usd_amount), 0)::text as amount,
              count(t.id)::text as count
            from buckets b
            left join kite_transfer t
              on date_trunc(${unit}, t.created_at at time zone ${timeZone}) = b.bucket
              and ${settledIn(from, to)}
            left join kite_quote q on q.id = t.quote_id
            group by b.bucket
            order by b.bucket
          `,
        ),
        db.execute<{
          id: string;
          symbol: string;
          decimals: number;
          name: string;
          icon: string | null;
          address: string;
          chain_id: string;
          caip2_id: string;
          volume: string;
          value: string;
        }>(
          sql`
            select tok.id, tok.symbol, tok.name, tok.icon, tok.decimals, tok.address, tok.chain_id,
              c.caip2_id,
              count(*)::text as volume,
              coalesce(sum(q.target_usd_amount), 0)::text as value
            from kite_transfer t
            join kite_quote q on q.id = t.quote_id
            join kite_token tok on tok.id = q.source_token_id
            join kite_chain c on c.id = tok.chain_id
            where ${settledIn(from, to)}
            group by tok.id, c.caip2_id
            order by ${
              rank === "value" ? sql`sum(q.target_usd_amount)` : sql`count(*)`
            } desc, tok.symbol asc
            limit 10
          `,
        ),
      ]);

    const chains = new Map(
      getSupportedChains().map((chain) => [chain.caip2Id as string, chain]),
    );
    const amount = Number(current.amount);
    const customerTotal = Number(customers.total);

    return {
      from: from.toISOString(),
      to: to.toISOString(),
      timeZone,
      customers: {
        total: customerTotal,
        change: percentChange(customerTotal, Number(customers.before)),
      },
      amountProcessed: {
        amount: current.amount,
        count: Number(current.count),
        change: percentChange(amount, Number(previous.amount)),
      },
      series: series.map((row) => ({
        bucket: row.bucket,
        amount: row.amount,
        count: Number(row.count),
      })),
      topTokens: topTokens.map((row) => ({
        id: row.id,
        symbol: row.symbol,
        name: row.name,
        icon: row.icon,
        decimals: row.decimals,
        address: row.address,
        chainId: row.chain_id,
        chainName: chains.get(row.caip2_id)?.name ?? null,
        chainIcon: chains.get(row.caip2_id)?.icon ?? null,
        volume: Number(row.volume),
        value: row.value,
      })),
    };
  };
}
