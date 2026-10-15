import { useQuery } from "@tanstack/react-query";
import {
  IconArrowDownRight,
  IconArrowRight,
  IconArrowUpRight,
  IconArrowsExchange,
  IconCalendar,
  IconChartLine,
  IconCoins,
} from "@tabler/icons-react";
import { useMemo, useState, type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
} from "recharts";
import {
  getApiOverviewStatsOptions,
  getApiTransfersOptions,
} from "@/api/@tanstack/react-query.gen";
import type { Stats } from "@/api/types.gen";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import {
  formatChange,
  formatCompactUsd,
  formatCount,
  formatDate,
  formatUsd,
  initials,
  shortId,
} from "@/lib/format";
import { useAppHeaders, useAppScope } from "@/lib/queries";
import { cn } from "@/lib/utils";
import SmartImage from "@/components/smart-image";

type Preset = "today" | "3d" | "7d" | "1m" | "custom";

const presets: { value: Preset; label: string }[] = [
  { value: "today", label: "Today" },
  { value: "3d", label: "3d" },
  { value: "7d", label: "7d" },
  { value: "1m", label: "1m" },
  { value: "custom", label: "Custom" },
];

const startOfDay = (date: Date) =>
  new Date(date.getFullYear(), date.getMonth(), date.getDate());

const addDays = (date: Date, days: number) =>
  new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);

const toInputDate = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

const rangeFor = (preset: Preset, custom: { from: string; to: string }) => {
  const today = startOfDay(new Date());
  const end = addDays(today, 1);

  switch (preset) {
    case "today":
      return { from: today, to: end };
    case "3d":
      return { from: addDays(today, -2), to: end };
    case "7d":
      return { from: addDays(today, -6), to: end };
    case "1m":
      return {
        from: new Date(
          today.getFullYear(),
          today.getMonth() - 1,
          today.getDate() + 1,
        ),
        to: end,
      };
    case "custom": {
      const from = new Date(`${custom.from}T00:00:00`);
      const to = addDays(new Date(`${custom.to}T00:00:00`), 1);
      return { from, to };
    }
  }
};

const Delta = ({ value }: { value: number | null }) => {
  const label = formatChange(value);
  if (value === null || !label) return null;

  const up = value >= 0;
  const Icon = up ? IconArrowUpRight : IconArrowDownRight;

  return (
    <span
      className={cn(
        "inline-flex items-center gap-0.5 text-xs font-medium",
        up ? "text-success" : "text-danger",
      )}
    >
      <Icon className="size-3.5" />
      {label}
    </span>
  );
};

const segment = (active: boolean) =>
  cn(
    "flex h-7 items-center gap-1.5 rounded-full px-2.5 text-xs font-medium transition-colors",
    active ? "bg-soft text-ink shadow-sm" : "text-muted hover:text-ink",
  );

const RangePicker = ({
  preset,
  onPreset,
  custom,
  onCustom,
}: {
  preset: Preset;
  onPreset: (preset: Preset) => void;
  custom: { from: string; to: string };
  onCustom: (range: { from: string; to: string }) => void;
}) => {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(custom);

  return (
    <div className="flex items-center gap-0.5 rounded-full bg-white p-1">
      {presets.map((item) =>
        item.value === "custom" ? (
          <Popover key={item.value} open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
              <button type="button" className={segment(preset === "custom")}>
                <IconCalendar className="size-3.5" />
                {preset === "custom"
                  ? `${custom.from} → ${custom.to}`
                  : item.label}
              </button>
            </PopoverTrigger>
            <PopoverContent className="w-72 space-y-3">
              <div className="grid grid-cols-2 gap-2">
                <label className="space-y-1 text-xs text-muted">
                  From
                  <Input
                    type="date"
                    className="text-xs"
                    value={draft.from}
                    max={draft.to}
                    onChange={(e) =>
                      setDraft({ ...draft, from: e.target.value })
                    }
                  />
                </label>
                <label className="space-y-1 text-xs text-muted">
                  To
                  <Input
                    type="date"
                    className="text-xs"
                    value={draft.to}
                    min={draft.from}
                    onChange={(e) => setDraft({ ...draft, to: e.target.value })}
                  />
                </label>
              </div>
              <Button
                size="sm"
                className="w-full"
                disabled={!draft.from || !draft.to || draft.from > draft.to}
                onClick={() => {
                  onCustom(draft);
                  onPreset("custom");
                  setOpen(false);
                }}
              >
                Apply
              </Button>
            </PopoverContent>
          </Popover>
        ) : (
          <button
            key={item.value}
            type="button"
            onClick={() => onPreset(item.value)}
            className={segment(preset === item.value)}
          >
            {item.label}
          </button>
        ),
      )}
    </div>
  );
};

const Metric = ({
  label,
  value,
  delta,
  hint,
  loading,
}: {
  label: string;
  value: ReactNode;
  delta?: number | null;
  hint?: ReactNode;
  loading?: boolean;
}) => (
  <div className="space-y-2 p-5">
    <p className="text-xs text-muted">{label}</p>
    {loading ? (
      <Skeleton className="my-1 h-6 w-24 rounded-md" />
    ) : (
      <div className="flex items-baseline gap-2">
        <span className="font-display text-3xl font-semibold tabular-nums tracking-tight">
          {value}
        </span>
        {delta !== undefined && <Delta value={delta} />}
      </div>
    )}

    {hint ? <p className="text-xs text-muted">{hint}</p> : null}
  </div>
);

const LoadingList = ({ rows, avatar }: { rows: number; avatar?: boolean }) => (
  <div className="divide-y divide-line" aria-busy="true" aria-label="Loading">
    {Array.from({ length: rows }, (_, row) => (
      <div key={row} className="flex items-center gap-3 px-4 py-3">
        {avatar && <Skeleton className="size-8 shrink-0" />}
        <div className="flex h-9 flex-1 flex-col justify-center gap-2">
          <Skeleton className="h-3 w-1/3" />
          <Skeleton className="h-2.5 w-1/4" />
        </div>
        <Skeleton className="h-3 w-16" />
      </div>
    ))}
  </div>
);

const Section = ({
  title,
  action,
  children,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
}) => (
  <Card className="min-w-0 overflow-hidden">
    <div className="flex h-14 items-center justify-between gap-3 px-4.5">
      <h2 className="text-sm font-medium">{title}</h2>
      {action}
    </div>
    {children}
  </Card>
);

const Brand = "#2f9bde";
const Line = "#ececec";
const Muted = "#8a8a8a";

const bucketLabel = (bucket: string, hourly: boolean) => {
  const date = new Date(bucket);
  return hourly
    ? date.toLocaleTimeString("en-US", { hour: "numeric" })
    : date.toLocaleDateString("en-US", { month: "short", day: "2-digit" });
};

const Growth = ({ series }: { series: Stats["series"] }) => {
  const hourly = series.length > 0 && series.length <= 48 && series.length > 7;
  const points = series.map((point) => ({
    ...point,
    value: Number(point.amount),
    label: bucketLabel(point.bucket, hourly),
  }));

  const interval = Math.max(0, Math.ceil(points.length / 12) - 1);

  return (
    <ResponsiveContainer width="100%" height={260}>
      <AreaChart
        data={points}
        margin={{ top: 8, right: 8, bottom: 0, left: 8 }}
      >
        <defs>
          <linearGradient id="growth" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={Brand} stopOpacity={0.18} />
            <stop offset="100%" stopColor={Brand} stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid
          vertical
          stroke={Line}
          strokeDasharray="0"
          horizontal={false}
        />
        <XAxis
          dataKey="label"
          interval={interval}
          tickLine={false}
          axisLine={false}
          tick={{ fontSize: 11, fill: Muted }}
          tickMargin={10}
          padding={{ left: 24, right: 24 }}
        />
        <Tooltip
          cursor={{ stroke: Brand, strokeWidth: 1 }}
          content={({ active, payload }) => {
            if (!active || !payload?.length) return null;
            const point = payload[0].payload as (typeof points)[number];

            return (
              <div className="rounded-xl border border-line bg-surface p-3 shadow-lg">
                <p className="text-xs text-muted">
                  {new Date(point.bucket).toLocaleString("en-US", {
                    dateStyle: "medium",
                    ...(hourly ? { timeStyle: "short" } : {}),
                  })}
                </p>
                <p className="mt-1 text-sm font-semibold">
                  {formatUsd(point.amount)}
                </p>
                <p className="text-xs text-muted">
                  {point.count} {point.count === 1 ? "transfer" : "transfers"}
                </p>
              </div>
            );
          }}
        />
        <Area
          type="linear"
          dataKey="value"
          stroke={Brand}
          strokeWidth={1.5}
          fill="url(#growth)"
          dot={false}
          activeDot={{ r: 4, fill: Brand, stroke: "white", strokeWidth: 2 }}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
};

export const Dashboard = () => {
  const { appId } = useAppScope();
  const headers = useAppHeaders();
  const navigate = useNavigate();
  const [preset, setPreset] = useState<Preset>("7d");
  const [rank, setRank] = useState<"value" | "volume">("value");
  const [custom, setCustom] = useState(() => {
    const today = new Date();
    return { from: toInputDate(addDays(today, -6)), to: toInputDate(today) };
  });

  const range = useMemo(() => {
    const { from, to } = rangeFor(preset, custom);
    return { from: from.toISOString(), to: to.toISOString() };
  }, [preset, custom]);

  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

  const stats = useQuery(
    getApiOverviewStatsOptions({
      query: { ...range, timeZone, rank },
      headers,
    }),
  );

  const transfers = useQuery(
    getApiTransfersOptions({ query: { pageSize: 6 }, headers }),
  );

  const data = stats.data;
  const hasVolume = !!data?.series.some((point) => Number(point.amount) > 0);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Overview"
        action={
          <RangePicker
            preset={preset}
            onPreset={setPreset}
            custom={custom}
            onCustom={setCustom}
          />
        }
      />

      <Card className="grid divide-y divide-line sm:grid-cols-3 sm:divide-x sm:divide-y-0">
        <Metric
          label="Amount processed"
          value={data ? formatCompactUsd(data.amountProcessed.amount) : "—"}
          delta={data?.amountProcessed.change ?? null}
          loading={stats.isLoading}
        />
        <Metric
          label="Settled transfers"
          value={data ? formatCount(data.amountProcessed.count) : "—"}
          loading={stats.isLoading}
        />
        <Metric
          label="Customers"
          value={data ? formatCount(data.customers.total) : "—"}
          delta={data?.customers.change ?? null}
          loading={stats.isLoading}
        />
      </Card>

      <Section title="Volume">
        {stats.isLoading ? (
          <div className="p-4" aria-busy="true" aria-label="Loading">
            <Skeleton className="h-65 w-full rounded-lg" />
          </div>
        ) : stats.error ? (
          <EmptyState
            icon={IconChartLine}
            title="Couldn't load volume"
            description={stats.error.message}
          />
        ) : data && !hasVolume ? (
          <EmptyState
            icon={IconChartLine}
            title="No volume in this range"
            description="Settled transfers will chart here. Try a wider range."
          />
        ) : (
          <div className="p-4">
            <Growth series={data?.series ?? []} />
          </div>
        )}
      </Section>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <Section
          title="Top tokens"
          action={
            <div className="flex rounded-full bg-soft p-0.5">
              {(["value", "volume"] as const).map((item) => (
                <button
                  key={item}
                  type="button"
                  onClick={() => setRank(item)}
                  className={cn(
                    segment(rank === item),
                    "capitalize",
                    rank === item && "bg-white",
                  )}
                >
                  {item}
                </button>
              ))}
            </div>
          }
        >
          {stats.isLoading ? (
            <LoadingList rows={5} avatar />
          ) : data?.topTokens.length === 0 ? (
            <EmptyState
              icon={IconCoins}
              title="No tokens yet"
              description="Tokens customers pay with show up once transfers settle."
            />
          ) : (
            <div className="divide-y divide-line">
              {data?.topTokens.map((token) => (
                <div
                  key={token.id}
                  className="flex items-center gap-3 px-4.5 py-3"
                >
                  <span className="flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-full bg-soft text-[10px] font-semibold">
                    {token.icon ? (
                      <img src={token.icon} alt="" className="size-8" />
                    ) : (
                      initials(token.symbol)
                    )}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">
                      {token.symbol}
                    </p>
                    <p className="truncate text-xs text-muted">{token.name}</p>
                  </div>
                  <p className="text-sm tabular-nums">
                    {rank === "value"
                      ? formatCompactUsd(token.value)
                      : `${token.volume} ${token.volume === 1 ? "transfer" : "transfers"}`}
                  </p>
                </div>
              ))}
            </div>
          )}
        </Section>

        <Section
          title="Recent transfers"
          action={
            appId ? (
              <Button
                variant={"outline"}
                size={"iconSm"}
                onClick={() => navigate(`/apps/${appId}/transfers`)}
              >
                <IconArrowRight className="size-4" />
              </Button>
            ) : null
          }
        >
          {transfers.isLoading ? (
            <LoadingList rows={6} />
          ) : transfers.data?.data.length === 0 ? (
            <EmptyState
              icon={IconArrowsExchange}
              title="No transfers yet"
              description={
                appId
                  ? "Share a payment link or create a quote to take a first payment."
                  : "Transfers from every app appear here as customers pay."
              }
              action={
                appId ? (
                  <Button
                    className="h-9.5 px-5"
                    onClick={() => navigate(`/apps/${appId}/payment-links`)}
                  >
                    Create payment link
                  </Button>
                ) : null
              }
            />
          ) : (
            <div className="divide-y divide-line">
              {transfers.data?.data.map((transfer) => {
                return (
                  <div
                    key={transfer.id}
                    className="flex flex-wrap items-center gap-3 px-4.5 py-3"
                  >
                    <div className="min-w-0 flex-1 basis-40">
                      <div className="flex items-center gap-2">
                        <p className="truncate font-display text-muted">
                          #{shortId(transfer.id)}...
                        </p>
                        <StatusBadge status={transfer.status} />
                      </div>
                      {!appId ? (
                        <Link
                          to={`/apps/${transfer.app.id}`}
                          className="flex items-center gap-1"
                        >
                          <SmartImage
                            url={transfer.app.icon}
                            className="size-7"
                          />
                          <p className="truncate text-sm font-">
                            {transfer.app.name}
                          </p>
                        </Link>
                      ) : null}
                    </div>

                    <div className="ml-auto min-w-20 text-right space-y-1">
                      <p className="text-sm tabular-nums font-medium">
                        {formatUsd(transfer.quote.targetUsdAmount)}
                      </p>

                      <p className="text-xs text-muted">
                        {formatDate(transfer.createdAt)}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Section>
      </div>
    </div>
  );
};
