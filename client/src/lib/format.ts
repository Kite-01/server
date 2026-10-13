const usd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 2,
});

const compactUsd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  notation: "compact",
  maximumFractionDigits: 1,
});

const compact = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 1,
});

export const formatUsd = (value: string | number) => usd.format(Number(value));

export const formatCompactUsd = (value: string | number) =>
  compactUsd.format(Number(value));

export const formatCount = (value: number) => compact.format(value);

export const formatChange = (value: number | null) =>
  value === null
    ? null
    : `${value > 0 ? "+" : ""}${value.toFixed(1).replace(/\.0$/, "")}%`;

export const formatDate = (value: string | Date) =>
  new Date(value).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });

export const formatDateTime = (value: string | Date) =>
  new Date(value).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

export const formatTokenAmount = (value: string | number, decimals: number) => {
  const raw = BigInt(value);
  const base = 10n ** BigInt(decimals);
  const whole = raw / base;
  const fraction = (raw % base).toString().padStart(decimals, "0");
  const trimmed = fraction.replace(/0+$/, "").slice(0, 6);

  return trimmed ? `${whole}.${trimmed}` : whole.toString();
};

export const shortAddress = (value: string) =>
  value.length > 12 ? `${value.slice(0, 6)}…${value.slice(-4)}` : value;

export const shortId = (value: string) => value.slice(0, 8);

export const initials = (value: string) =>
  value
    .split(/[\s@._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]!.toUpperCase())
    .join("") || "?";

export const parseUnits = (value: string, decimals: number) => {
  const [whole = "0", fraction = ""] = value.trim().split(".");

  if (!/^\d*$/.test(whole) || !/^\d*$/.test(fraction)) {
    throw new Error("Enter a valid amount");
  }

  if (fraction.length > decimals) {
    throw new Error(`This token supports ${decimals} decimal places`);
  }

  const units =
    BigInt(whole || "0") * 10n ** BigInt(decimals) +
    BigInt(fraction.padEnd(decimals, "0") || "0");

  if (units <= 0n) throw new Error("Amount must be greater than zero");
  return units.toString();
};
