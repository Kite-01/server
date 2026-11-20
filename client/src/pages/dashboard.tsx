import { useQuery } from "@tanstack/react-query";
import {
  IconArrowRight,
  IconArrowsExchange,
  IconCalendar,
  IconCaretDownFilled,
  IconCaretUpFilled,
  IconChartLine,
  IconCoins,
} from "@tabler/icons-react";
import { useMemo, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
} from "recharts";
import {
  overviewStatsOptions,
  transfersListOptions,
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
import { Table, Td, Th } from "@/components/ui/table";
import {
  formatChange,
  formatCompactUsd,
  formatCount,
  formatDate,
  formatUsd,
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

const Delta = ({
  value,
  suffix,
}: {
  value: number | null;
  suffix?: string;
}) => {
  const label = formatChange(value);
  if (value === null || !label) return null;

  const up = value >= 0;
  const Icon = up ? IconCaretUpFilled : IconCaretDownFilled;

  return (
    <span className="inline-flex items-center gap-2 text-sm text-muted">
      <span
        className={cn(
          "inline-flex items-center gap-0.5 rounded-full bg-surface px-2 py-0.5 font-medium shadow-[0_1px_2px_rgb(0_0_0/0.06)] ring-1 ring-line",
          up ? "text-success" : "text-danger",
        )}
      >
        <Icon className="size-3" />
        {label.replace(/^[+-]/, "")}
      </span>
      {suffix}
    </span>
  );
};

const Money = ({ value, className }: { value: string; className?: string }) => {
  const [whole, cents = "00"] = formatUsd(value)
    .replace(/(\.\d)$/, "$10")
    .split(".");
  const hasCents = formatUsd(value).includes(".");

  return (
    <span className={cn("tabular-nums", className)}>
      {whole}
      <span className="text-muted/60">.{hasCents ? cents : "00"}</span>
    </span>
  );
};

const segment = (active: boolean) =>
  cn(
    "flex h-8 items-center gap-1.5 rounded-full px-3 text-[13px] font-medium transition-colors",
    active ? "bg-ink text-white" : "text-muted hover:text-ink",
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
    <div className="flex items-center gap-0.5 rounded-full border border-line bg-surface p-1">
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

const LoadingList = ({ rows, avatar }: { rows: number; avatar?: boolean }) => (
  <div className="divide-y divide-line" aria-busy="true" aria-label="Loading">
    {Array.from({ length: rows }, (_, row) => (
      <div key={row} className="flex items-center gap-3 py-3.5">
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

const Panel = ({
  title,
  hint,
  action,
  children,
  className,
}: {
  title: string;
  hint?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) => (
  <Card className={cn("min-w-0 p-6 sm:p-7", className)}>
    <div className="mb-5 flex items-start justify-between gap-3">
      <div className="min-w-0">
        <h2 className="text-lg font-medium">{title}</h2>
        {hint ? <p className="mt-0.5 text-sm text-muted">{hint}</p> : null}
      </div>
      {action}
    </div>
    {children}
  </Card>
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
  <Card className="min-w-0 overflow-hidden pb-1.5">
    <div className="flex h-13 items-center justify-between gap-3 px-4.5">
      <h2 className="text-sm font-medium">{title}</h2>
      {action}
    </div>
    {children}
  </Card>
);

const Ink = "#0a0a0a";
const Kite = "#fcc101";
const Line = "#e8e7e3";
const Muted = "#75756f";

const bucketLabel = (bucket: string, hourly: boolean) => {
  const date = new Date(bucket);
  return hourly
    ? date.toLocaleTimeString("en-US", { hour: "numeric" })
    : date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
};

const isHourly = (series: Stats["series"]) =>
  series.length > 7 && series.length <= 48;

const Growth = ({ series }: { series: Stats["series"] }) => {
  const hourly = isHourly(series);
  const points = series.map((point) => ({
    ...point,
    value: Number(point.amount),
    label: bucketLabel(point.bucket, hourly),
  }));

  const interval = Math.max(0, Math.ceil(points.length / 7) - 1);

  return (
    <ResponsiveContainer width="100%" height={240}>
      <AreaChart
        data={points}
        margin={{ top: 12, right: 4, bottom: 0, left: 4 }}
      >
        <CartesianGrid vertical stroke={Line} horizontal={false} />
        <XAxis
          dataKey="label"
          interval={interval}
          tickLine={false}
          axisLine={false}
          tick={{ fontSize: 12, fill: Muted }}
          tickMargin={12}
          padding={{ left: 28, right: 28 }}
        />
        <Tooltip
          cursor={{ stroke: Ink, strokeWidth: 1, strokeDasharray: "3 3" }}
          content={({ active, payload }) => {
            if (!active || !payload?.length) return null;
            const point = payload[0].payload as (typeof points)[number];

            return (
              <div className="min-w-36 rounded-2xl bg-ink px-3.5 py-3 text-white shadow-xl">
                <p className="text-xs text-white/60">
                  {new Date(point.bucket).toLocaleString("en-US", {
                    dateStyle: "medium",
                    ...(hourly ? { timeStyle: "short" } : {}),
                  })}
                </p>
                <p className="mt-1 text-base font-medium tabular-nums">
                  {formatUsd(point.amount)}
                </p>
                <p className="text-xs text-white/60">
                  {point.count} {point.count === 1 ? "payment" : "payments"}
                </p>
              </div>
            );
          }}
        />
        <Area
          type="monotone"
          dataKey="value"
          stroke={Ink}
          strokeWidth={1.75}
          fill={Ink}
          fillOpacity={0.045}
          dot={false}
          activeDot={{ r: 5, fill: Kite, stroke: Ink, strokeWidth: 1.5 }}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
};

const DotsPerDay = ({ series }: { series: Stats["series"] }) => {
  const hourly = isHourly(series);
  const shown = series.slice(-14);
  const max = Math.max(1, ...shown.map((point) => point.count));
  const rows = Math.min(10, Math.max(6, max));
  const peak = shown.reduce(
    (best, point) => (point.count > best.count ? point : best),
    shown[0] ?? { bucket: "", count: 0, amount: "0" },
  );

  return (
    <div className="flex flex-1 flex-col justify-end">
      {peak.count > 0 ? (
        <p className="mb-auto inline-flex w-fit items-center gap-2 rounded-full bg-surface px-3.5 py-1.5 text-sm shadow-[0_1px_2px_rgb(0_0_0/0.06)] ring-1 ring-line">
          <span className="text-muted">Peak</span>
          <span className="font-medium">
            {bucketLabel(peak.bucket, hourly)}
          </span>
          <span className="h-3.5 w-px bg-line" aria-hidden />
          <span className="font-medium tabular-nums">
            {peak.count} {peak.count === 1 ? "payment" : "payments"}
          </span>
        </p>
      ) : null}
      <div
        className="mt-8 flex items-end justify-between gap-1"
        role="img"
        aria-label={`Settled payments per ${hourly ? "hour" : "day"}, peaking at ${peak.count}`}
      >
        {shown.map((point) => {
          const lit = Math.round((point.count / max) * rows);
          const isPeak = point.bucket === peak.bucket && peak.count > 0;
          return (
            <div
              key={point.bucket}
              className="flex flex-1 flex-col-reverse items-center gap-2"
              title={`${bucketLabel(point.bucket, hourly)}: ${point.count}`}
            >
              {Array.from({ length: rows }, (_, i) => (
                <span
                  key={i}
                  className={cn(
                    "size-2.5 rounded-full transition-colors sm:size-3.5",
                    i >= lit ? "bg-line/60" : isPeak ? "bg-kite" : "bg-ink/80",
                  )}
                />
              ))}
            </div>
          );
        })}
      </div>
      <div className="mt-3 flex justify-between text-xs text-muted">
        <span>{shown[0] ? bucketLabel(shown[0].bucket, hourly) : ""}</span>
        <span>
          {shown.at(-1) ? bucketLabel(shown.at(-1)!.bucket, hourly) : ""}
        </span>
      </div>
    </div>
  );
};

const Fact = ({
  label,
  value,
  loading,
}: {
  label: string;
  value: ReactNode;
  loading?: boolean;
}) => (
  <div className="flex items-center justify-between gap-4 border-b border-line py-4 first:pt-0 last:border-0 last:pb-0">
    <span className="text-[15px] text-muted">{label}</span>
    {loading ? (
      <Skeleton className="h-3.5 w-16" />
    ) : (
      <span className="text-[15px] font-medium tabular-nums">{value}</span>
    )}
  </div>
);

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
    overviewStatsOptions({
      query: { ...range, timeZone, rank },
      headers,
    }),
  );

  const transfers = useQuery(
    transfersListOptions({ query: { pageSize: 6 }, headers }),
  );

  const data = stats.data;
  const hasVolume = !!data?.series.some((point) => Number(point.amount) > 0);
  const count = data?.amountProcessed.count ?? 0;
  const average = count ? Number(data!.amountProcessed.amount) / count : 0;
  const busiest = data?.series.reduce(
    (best, point) =>
      Number(point.amount) > Number(best.amount) ? point : best,
    data.series[0],
  );
  const tokenTotal =
    data?.topTokens.reduce(
      (sum, token) =>
        sum + (rank === "value" ? Number(token.value) : token.volume),
      0,
    ) ?? 0;

  return (
    <div className="space-y-4">
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

      <Card className="grid overflow-hidden lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0 p-6 sm:p-8">
          <p className="text-[15px] text-muted">Processed volume</p>
          {stats.isLoading ? (
            <Skeleton className="my-3 h-12 w-56 rounded-xl" />
          ) : (
            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2">
              <Money
                value={data?.amountProcessed.amount ?? "0"}
                className="text-[44px] leading-none tracking-[-0.045em] sm:text-[56px]"
              />
              <Delta
                value={data?.amountProcessed.change ?? null}
                suffix="vs the period before"
              />
            </div>
          )}

          <div className="mt-6">
            {stats.isLoading ? (
              <Skeleton className="h-60 w-full rounded-2xl" />
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
                description="Settled transfers chart here. Try a wider range."
              />
            ) : (
              <Growth series={data?.series ?? []} />
            )}
          </div>
        </div>

        <div className="flex flex-col justify-between gap-8 bg-soft/60 p-6 sm:p-8 lg:border-s lg:border-line">
          <div>
            <Fact
              label="Settled payments"
              value={formatCount(count)}
              loading={stats.isLoading}
            />
            <Fact
              label="Average payment"
              value={count ? formatUsd(average) : "—"}
              loading={stats.isLoading}
            />
            <Fact
              label="Customers"
              value={data ? formatCount(data.customers.total) : "—"}
              loading={stats.isLoading}
            />
            <Fact
              label="Tokens paid in"
              value={data ? data.topTokens.length : "—"}
              loading={stats.isLoading}
            />
          </div>
          {busiest && Number(busiest.amount) > 0 ? (
            <p className="text-[15px] leading-relaxed text-muted">
              Your busiest {isHourly(data!.series) ? "hour" : "day"} was{" "}
              <span className="font-medium text-ink">
                {bucketLabel(busiest.bucket, isHourly(data!.series))}
              </span>
              , with{" "}
              <span className="font-medium text-ink">
                {formatUsd(busiest.amount)}
              </span>{" "}
              across {busiest.count}{" "}
              {busiest.count === 1 ? "payment" : "payments"}.
            </p>
          ) : null}
        </div>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel
          className="flex flex-col"
          title="Payments settled"
          hint={`Per ${data && isHourly(data.series) ? "hour" : "day"}, most recent last`}
        >
          {stats.isLoading ? (
            <Skeleton className="h-44 w-full rounded-2xl" />
          ) : hasVolume ? (
            <DotsPerDay series={data!.series} />
          ) : (
            <EmptyState
              icon={IconChartLine}
              title="Nothing settled yet"
              description="Each settled payment adds a dot here."
            />
          )}
        </Panel>

        <Panel
          title="Top tokens"
          hint="What customers pay with"
          action={
            <div className="flex rounded-full border border-line p-0.5">
              {(["value", "volume"] as const).map((item) => (
                <button
                  key={item}
                  type="button"
                  onClick={() => setRank(item)}
                  className={cn(segment(rank === item), "h-7 capitalize")}
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
            <ol className="divide-y divide-line">
              {data?.topTokens.slice(0, 6).map((token, i) => {
                const amount =
                  rank === "value" ? Number(token.value) : token.volume;
                const share = tokenTotal ? (amount / tokenTotal) * 100 : 0;
                return (
                  <li key={token.id} className="flex items-center gap-3 py-3">
                    <span className="w-4 text-sm text-muted tabular-nums">
                      {i + 1}
                    </span>
                    <div className="relative shrink-0">
                      <SmartImage url={token.icon} className="size-8" />
                      {token.chainIcon && (
                        <span
                          className="absolute -bottom-0.5 -right-0.5"
                          title={token.chainName ?? undefined}
                        >
                          <SmartImage
                            url={token.chainIcon}
                            alt={token.chainName ?? ""}
                            className="size-4 border-white bg-white"
                          />
                        </span>
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[15px] font-medium">
                        {token.symbol}
                      </p>
                      <p className="truncate text-xs text-muted">
                        {token.chainName}
                      </p>
                    </div>
                    <span className="hidden text-sm text-muted tabular-nums sm:inline">
                      {share.toFixed(1)}%
                    </span>
                    <span className="w-20 text-end text-[15px] font-medium tabular-nums">
                      {rank === "value"
                        ? formatCompactUsd(token.value)
                        : token.volume.toLocaleString()}
                    </span>
                  </li>
                );
              })}
            </ol>
          )}
        </Panel>
      </div>

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
          <Table>
            <thead>
              <tr>
                <Th>Transfer</Th>
                {!appId ? <Th>App</Th> : null}
                <Th>Status</Th>
                <Th className="text-right">Amount</Th>
                <Th className="text-right">Created</Th>
              </tr>
            </thead>
            <tbody>
              {transfers.data?.data.map((transfer) => (
                <tr
                  key={transfer.id}
                  onClick={() =>
                    navigate(`/apps/${appId ?? transfer.app.id}/transfers`)
                  }
                  className="cursor-pointer transition-colors hover:bg-soft/60"
                >
                  <Td className="font-display text-muted">
                    #{shortId(transfer.id)}
                  </Td>
                  {!appId ? (
                    <Td>
                      <span className="flex items-center gap-2">
                        <SmartImage
                          url={transfer.app.icon}
                          className="size-6"
                        />
                        <span className="truncate">{transfer.app.name}</span>
                      </span>
                    </Td>
                  ) : null}
                  <Td>
                    <StatusBadge status={transfer.status} />
                  </Td>
                  <Td className="text-right font-medium tabular-nums">
                    {formatUsd(transfer.quote.targetUsdAmount)}
                  </Td>
                  <Td className="text-right text-muted">
                    {formatDate(transfer.createdAt)}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Section>
    </div>
  );
};
