import {
  ArrowDownRight,
  ArrowUpRight,
  CalendarDays,
  Search,
} from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
} from "recharts";
import { StatusBadge } from "@/components/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  formatChange,
  formatCompactUsd,
  formatCount,
  formatDate,
  formatDateTime,
  formatUsd,
  initials,
  shortId,
} from "@/lib/format";
import { useAppScope, useGet, type Page } from "@/lib/queries";
import { cn } from "@/lib/utils";

type Stats = {
  customers: { total: number; change: number | null };
  amountProcessed: { amount: string; count: number; change: number | null };
  series: { bucket: string; amount: string; count: number }[];
  topTokens: {
    id: string;
    symbol: string;
    name: string;
    icon: string | null;
    volume: number;
    value: string;
  }[];
};

type Transfer = {
  id: string;
  status: string;
  createdAt: string;
  app: { id: string; name: string };
  quote: {
    targetUsdAmount: string;
    sourceToken: { symbol: string };
    customer: { name: string | null; externalId: string } | null;
  };
};

type AppEvent = {
  id: string;
  category: string;
  previousCategoryStatus: string | null;
  currentCategoryStatus: string;
  createdAt: string;
};

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
  const Icon = up ? ArrowUpRight : ArrowDownRight;

  return (
    <Badge variant={up ? "success" : "danger"}>
      <Icon className="size-3.5" />
      {label}
    </Badge>
  );
};

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
    <div className="flex items-center gap-1 rounded-full border border-line p-1">
      {presets.map((item) =>
        item.value === "custom" ? (
          <Popover key={item.value} open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
              <button
                type="button"
                className={cn(
                  "flex h-8 items-center gap-1.5 rounded-full px-3 text-xs font-medium",
                  preset === "custom"
                    ? "bg-ink text-white"
                    : "text-muted hover:text-ink",
                )}
              >
                <CalendarDays className="size-3.5" />
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
            className={cn(
              "h-8 rounded-full px-3 text-xs font-medium",
              preset === item.value
                ? "bg-ink text-white"
                : "text-muted hover:text-ink",
            )}
          >
            {item.label}
          </button>
        ),
      )}
    </div>
  );
};

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
  const [preset, setPreset] = useState<Preset>("7d");
  const [rank, setRank] = useState<"value" | "volume">("value");
  const [search, setSearch] = useState("");
  const [custom, setCustom] = useState(() => {
    const today = new Date();
    return { from: toInputDate(addDays(today, -6)), to: toInputDate(today) };
  });

  const range = useMemo(() => {
    const { from, to } = rangeFor(preset, custom);
    return { from: from.toISOString(), to: to.toISOString() };
  }, [preset, custom]);

  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

  const stats = useGet<Stats>("/api/admin/stats", { ...range, timeZone, rank });
  const transfers = useGet<Page<Transfer>>("/api/transfers", {
    pageSize: 5,
    q: search.trim() || undefined,
  });
  const events = useGet<Page<AppEvent>>("/api/admin/events", { pageSize: 8 });

  return (
    <div className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_320px]">
      <div className="min-w-0 space-y-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="relative w-full max-w-sm">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
            <Input
              className="rounded-full pl-9"
              placeholder="Search transfers"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>
          <RangePicker
            preset={preset}
            onPreset={setPreset}
            custom={custom}
            onCustom={setCustom}
          />
        </div>

        <div className="grid gap-8 lg:grid-cols-[240px_minmax(0,1fr)]">
          <div className="space-y-8">
            <div>
              <p className="text-sm text-muted">Total customers</p>
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <span className="text-3xl font-semibold">
                  {stats.data ? formatCount(stats.data.customers.total) : "—"}
                </span>
                <Delta value={stats.data?.customers.change ?? null} />
              </div>
            </div>
            <div>
              <p className="text-sm text-muted">Amount processed</p>
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <span className="text-3xl font-semibold">
                  {stats.data
                    ? formatCompactUsd(stats.data.amountProcessed.amount)
                    : "—"}
                </span>
                <Delta value={stats.data?.amountProcessed.change ?? null} />
              </div>
              {stats.data && (
                <p className="mt-1 text-xs text-muted">
                  {stats.data.amountProcessed.count} settled{" "}
                  {stats.data.amountProcessed.count === 1
                    ? "transfer"
                    : "transfers"}
                </p>
              )}
            </div>
          </div>

          <Card className="p-4">
            {stats.error ? (
              <p className="p-8 text-center text-sm text-danger">
                {stats.error.message}
              </p>
            ) : (
              <Growth series={stats.data?.series ?? []} />
            )}
          </Card>
        </div>

        <div className="grid gap-8 lg:grid-cols-[300px_minmax(0,1fr)]">
          <div>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm text-muted">Top tokens</h2>
              <div className="flex rounded-full border border-line p-0.5">
                {(["value", "volume"] as const).map((item) => (
                  <button
                    key={item}
                    type="button"
                    onClick={() => setRank(item)}
                    className={cn(
                      "rounded-full px-3 py-1 text-xs font-medium capitalize",
                      rank === item ? "bg-ink text-white" : "text-muted",
                    )}
                  >
                    {item}
                  </button>
                ))}
              </div>
            </div>
            <Card className="divide-y divide-line">
              {stats.data?.topTokens.length === 0 && (
                <p className="p-6 text-center text-sm text-muted">
                  No settled transfers in this range
                </p>
              )}
              {stats.data?.topTokens.map((token) => (
                <div key={token.id} className="flex items-center gap-3 p-3">
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-soft text-xs font-semibold">
                    {token.icon ? (
                      <img
                        src={token.icon}
                        alt=""
                        className="size-9 rounded-full"
                      />
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
                  <p className="text-sm font-medium">
                    {rank === "value"
                      ? formatCompactUsd(token.value)
                      : `${token.volume} ${token.volume === 1 ? "transfer" : "transfers"}`}
                  </p>
                </div>
              ))}
            </Card>
          </div>

          <div className="min-w-0">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm text-muted">Recent transfers</h2>
              {appId && (
                <Link
                  to={`/apps/${appId}/transfers`}
                  className="inline-flex h-8 items-center rounded-full border border-line px-3 text-xs font-medium hover:bg-soft"
                >
                  Go to transfers
                </Link>
              )}
            </div>
            <Card className="divide-y divide-line">
              {transfers.data?.data.length === 0 && (
                <p className="p-6 text-center text-sm text-muted">
                  No transfers yet
                </p>
              )}
              {transfers.data?.data.map((transfer) => {
                const customer = transfer.quote.customer;
                const name =
                  customer?.name ?? customer?.externalId ?? "No customer";

                return (
                  <div
                    key={transfer.id}
                    className="flex flex-wrap items-center gap-3 p-4"
                  >
                    <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-brand-soft text-xs font-semibold text-brand">
                      {initials(name)}
                    </span>
                    <div className="min-w-0 flex-1 basis-40">
                      <p className="truncate text-sm font-medium">{name}</p>
                      <p className="truncate text-xs text-muted">
                        {appId
                          ? `#${shortId(transfer.id)}`
                          : `${transfer.app.name} · #${shortId(transfer.id)}`}
                      </p>
                    </div>
                    <StatusBadge status={transfer.status} />
                    <div className="ml-auto min-w-20 text-right">
                      <p className="text-sm font-medium">
                        {formatUsd(transfer.quote.targetUsdAmount)}
                      </p>
                      <p className="text-xs text-muted">
                        {transfer.quote.sourceToken.symbol} ·{" "}
                        {formatDate(transfer.createdAt)}
                      </p>
                    </div>
                  </div>
                );
              })}
            </Card>
          </div>
        </div>
      </div>

      <aside>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm text-muted">Activities</h2>
          <Badge variant="count">{events.data?.total ?? 0}</Badge>
        </div>
        <Card className="divide-y divide-line">
          {events.data?.data.length === 0 && (
            <p className="p-6 text-center text-sm text-muted">
              No activity yet
            </p>
          )}
          {events.data?.data.map((event) => (
            <div key={event.id} className="p-4">
              <p className="text-sm font-medium">{event.category}</p>
              <p className="text-xs text-muted">
                {event.previousCategoryStatus
                  ? `${event.previousCategoryStatus} → ${event.currentCategoryStatus}`
                  : event.currentCategoryStatus}
              </p>
              <p className="mt-1 text-xs text-muted">
                {formatDateTime(event.createdAt)}
              </p>
            </div>
          ))}
        </Card>
      </aside>
    </div>
  );
};
