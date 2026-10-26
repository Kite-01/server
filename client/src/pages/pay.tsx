import type {
  Checkout,
  CheckoutTransfer,
  CreatedTransfer,
  Quote,
  TokenWithChain,
} from "@/api";
import {
  checkoutGetOptions,
  checkoutGetTransferOptions,
} from "@/api/@tanstack/react-query.gen";
import {
  checkoutCancelTransfer,
  checkoutOpenTransfer,
  checkoutQuote,
} from "@/api/sdk.gen";
import { CopyButton } from "@/components/copy-button";
import { Field } from "@/components/field";
import { Logo } from "@/components/logo";
import SmartImage from "@/components/smart-image";
import { Button, type ButtonProps } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import { shortAddress } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  connectWallet,
  discoverWallets,
  sendToken,
  switchChain,
  walletMessage,
  type CheckoutChain,
  type Wallet,
} from "@/lib/wallet";
import {
  IconAlertCircleFilled,
  IconArrowBackUp,
  IconArrowLeft,
  IconArrowUpRight,
  IconCheck,
  IconChevronDown,
  IconChevronLeft,
  IconChevronRight,
  IconCircleCheckFilled,
  IconCircleXFilled,
  IconClockHour4,
  IconInfoCircle,
  IconLayersLinked,
  IconLoader2,
  IconPaywall,
  IconSearch,
  IconWallet,
  IconX,
} from "@tabler/icons-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { QRCodeSVG } from "qrcode.react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useParams } from "react-router-dom";
import { formatUnits, isAddress, type Address } from "viem";

type Token = CheckoutChain["tokens"][number];

type Step =
  | { kind: "method" }
  | { kind: "wallets"; wallets: Wallet[] }
  | { kind: "wallet" }
  | { kind: "token" }
  | { kind: "review" }
  | { kind: "instructions"; transfer: CreatedTransfer }
  | { kind: "status"; transferId: string; txHash?: string };

type Busy = { on: string; label: string } | null;

const Waiting = ["Created", "AwaitingDeposit"];
const Final = ["Settled", "Refunded", "Failed", "Cancelled"];

// Opened with ?embed by @kite-01/js, which shows this page in a frame and
// listens for these messages.
const embedded =
  new URLSearchParams(window.location.search).has("embed") &&
  window.parent !== window;

type EmbedMessage =
  | { type: "ready"; paymentLinkId: string }
  | { type: "status"; transferId: string; status: string }
  | { type: "success"; transferId: string }
  | { type: "failed"; transferId?: string; reason: string }
  | { type: "close" };

const notify = (message: EmbedMessage) => {
  if (embedded) window.parent.postMessage({ source: "kite", ...message }, "*");
};

type Outcome = "completed" | "failed" | "cancelled";

// The merchant's return URL, told how the payment ended.
const returnTo = (url: string, status: Outcome, transferId?: string) => {
  const target = new URL(url);
  target.searchParams.set("status", status);
  if (transferId) target.searchParams.set("transferId", transferId);
  else target.searchParams.delete("transferId");

  return target.toString();
};

const outcomeOf = (
  status: string | undefined,
  expired: boolean,
): Outcome | null => {
  if (status === "Settled") return "completed";
  if (status === "Failed" || status === "Refunded") return "failed";
  if (status === "Cancelled" || expired) return "cancelled";
  return null;
};

const formatMoney = (amount: string | number, currency: string) => {
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
      currencyDisplay: "narrowSymbol",
      maximumFractionDigits: 8,
    }).format(Number(amount));
  } catch {
    // Not an ISO 4217 code (e.g. a crypto feed); show it as written.
    return `${Number(amount).toLocaleString(undefined, { maximumFractionDigits: 8 })} ${currency}`;
  }
};

const useNow = () => {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  return now;
};

const Countdown = ({ until }: { until: string }) => {
  const left = Math.max(0, new Date(until).getTime() - useNow());
  const minutes = Math.floor(left / 60_000);
  const seconds = Math.floor((left % 60_000) / 1000);

  return (
    <span className={cn("tabular-nums", left < 60_000 && "text-danger")}>
      {minutes}:{seconds.toString().padStart(2, "0")}
    </span>
  );
};

// API errors are `{ error: { message } }`.
const failure = (body: unknown, fallback: string) =>
  (body as { error?: { message?: string } } | null)?.error?.message ?? fallback;

const Monogram = ({
  label,
  className,
}: {
  label: string;
  className?: string;
}) => (
  <span
    className={cn(
      "flex size-9 shrink-0 items-center justify-center rounded-full bg-linear-to-b from-[#b4b4b9] to-[#8e8e93] font-display text-sm font-semibold text-white",
      className,
    )}
  >
    {label.slice(0, 1).toUpperCase()}
  </span>
);

const TokenIcon = ({
  token,
  className,
}: {
  token: Pick<Token, "icon" | "symbol">;
  className?: string;
}) => (
  <SmartImage url={token.icon} alt="" className={cn("size-8", className)} />
);

const ChainLogo = ({
  chain,
  className,
}: {
  chain: CheckoutChain;
  className?: string;
}) => (
  <SmartImage
    url={chain.icon}
    alt=""
    className={cn("size-5 rounded-full border-none", className)}
    fallbackComponent={() => (
      <Monogram
        label={chain.name}
        className={cn("size-5 text-[10px]", className)}
      />
    )}
  />
);

const ChainLabel = ({ chain }: { chain: CheckoutChain }) => (
  <span className="inline-flex min-w-0 items-center gap-2">
    <ChainLogo chain={chain} />
    <span className="truncate">{chain.name}</span>
    {chain.testnet}
  </span>
);

const ErrorNote = ({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) => (
  <div
    className={cn(
      "flex items-start gap-2 rounded-xl bg-danger/8 px-3.5 py-3 text-[13px] text-danger",
      className,
    )}
  >
    <IconAlertCircleFilled className="mt-px size-4 shrink-0" />
    <div className="min-w-0 wrap-break-word">{children}</div>
  </div>
);

const SheetHeader = ({
  title,
  onBack,
  accessory,
}: {
  title: string;
  onBack?: () => void;
  accessory?: ReactNode;
}) => (
  <header className="relative flex items-center justify-center">
    {onBack && (
      <button
        type="button"
        aria-label="Back"
        onClick={onBack}
        className="absolute left-0 flex size-10 items-center justify-center rounded-full text-ink transition-colors hover:bg-soft"
      >
        <IconChevronLeft className="size-5" />
      </button>
    )}
    <h2 className="truncate text-[17px] font-semibold tracking-tight">
      {title}
    </h2>
    {accessory && <div className="absolute right-0">{accessory}</div>}
  </header>
);

const IconTile = ({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) => (
  <span
    className={cn(
      "flex size-10 shrink-0 items-center justify-center rounded-full text-white [&_svg]:size-5",
      className,
    )}
  >
    {children}
  </span>
);

const Option = ({
  icon,
  title,
  description,
  onClick,
  disabled,
  busy,
}: {
  icon: ReactNode;
  title: string;
  description?: string;
  onClick: () => void;
  disabled?: boolean;
  busy?: boolean;
}) => (
  <button
    type="button"
    onClick={onClick}
    disabled={disabled}
    className="group flex w-full items-center gap-3.5 px-4 py-3.5 text-left font-sans! transition-colors hover:bg-soft/70 disabled:cursor-not-allowed disabled:hover:bg-transparent [&:disabled>*]:opacity-50"
  >
    {icon}
    <span className="min-w-0 flex-1">
      <span className="block text-[15px] font-medium">{title}</span>
      {description && (
        <span className="mt-0.5 block text-[13px] leading-snug text-muted">
          {description}
        </span>
      )}
    </span>
    {busy ? (
      <IconLoader2 className="size-4 shrink-0 animate-spin text-muted" />
    ) : (
      <IconChevronRight className="size-4 shrink-0 text-muted/70 transition-transform group-enabled:group-hover:translate-x-0.5" />
    )}
  </button>
);

const Group = ({ children }: { children: ReactNode }) => (
  <div className="divide-y divide-line overflow-hidden rounded-2xl border border-line">
    {children}
  </div>
);

const Rows = ({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) => (
  <div className={cn("divide-y divide-line border-b border-line", className)}>
    {children}
  </div>
);

const Row = ({
  label,
  children,
  onClick,
}: {
  label: string;
  children: ReactNode;
  onClick?: () => void;
}) => {
  const content = (
    <>
      <span className="shrink-0 text-sm text-muted">{label}</span>
      <span className="flex min-w-0 items-center justify-end gap-2 text-sm font-medium">
        {children}
        {onClick && (
          <IconChevronRight className="size-4 shrink-0 text-muted/70" />
        )}
      </span>
    </>
  );

  return onClick ? (
    <button
      type="button"
      onClick={onClick}
      className="-mx-2 flex min-h-13 w-[calc(100%+1rem)] items-center justify-between gap-4 rounded-lg px-2 py-2.5 text-left font-sans transition-colors"
    >
      {content}
    </button>
  ) : (
    <div className="flex min-h-13 items-center justify-between gap-4 py-2.5">
      {content}
    </div>
  );
};

const Primary = ({
  busy,
  children,
  className,
  disabled,
  ...props
}: ButtonProps & { busy?: boolean }) => (
  <Button
    className={cn("h-12 w-full text-[15px]", className)}
    disabled={disabled || busy}
    {...props}
  >
    {busy ? <IconLoader2 className="size-4 animate-spin" /> : children}
  </Button>
);

// `compact` shows just the logo, for the spot beside the token search.
const ChainSwitcher = ({
  chains,
  value,
  onChange,
  compact,
}: {
  chains: CheckoutChain[];
  value: string;
  onChange: (chainId: string) => void;
  compact?: boolean;
}) => {
  const [open, setOpen] = useState(false);
  const current = chains.find((chain) => chain.id === value);
  if (!current) return null;

  const face = compact ? (
    <ChainLogo chain={current} className="size-6" />
  ) : (
    <ChainLabel chain={current} />
  );
  const tile =
    "inline-flex h-11 min-w-11 shrink-0 items-center justify-center gap-1 rounded-xl bg-soft px-2.5";

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          title={current.name}
          aria-label={`Network: ${current.name}`}
          className={cn(
            "font-sans text-sm font-medium transition-colors",
            compact
              ? cn(tile, "hover:bg-line")
              : "-mr-1.5 inline-flex min-w-0 items-center gap-1 rounded-full py-1 pr-1 pl-1.5 hover:bg-soft",
          )}
        >
          {face}
          <IconChevronDown className="size-4 shrink-0 text-muted" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-70 rounded-2xl p-1.5">
        {chains.map((chain) => (
          <button
            key={chain.id}
            type="button"
            onClick={() => {
              onChange(chain.id);
              setOpen(false);
            }}
            className="flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2.5 text-left font-sans text-sm transition-colors hover:bg-soft"
          >
            <ChainLogo chain={chain} className="size-6" />
            <span className="min-w-0 flex-1 truncate">{chain.name}</span>
            <IconCheck
              className={cn("size-4", chain.id !== value && "invisible")}
            />
          </button>
        ))}
      </PopoverContent>
    </Popover>
  );
};

const Total = ({
  label,
  token,
  quote,
  loading,
}: {
  label: string;
  token: Token;
  quote?: Quote;
  loading: boolean;
}) => (
  <div className="flex items-start justify-between gap-4 py-5">
    <span className="pt-1.5 text-sm font-medium">{label}</span>
    <div className="min-w-0 text-right">
      {loading ? (
        <>
          <Skeleton className="ml-auto h-8 w-36 rounded-lg" />
          <Skeleton className="mt-2 ml-auto h-3 w-24" />
        </>
      ) : quote ? (
        <>
          <p className="font-display text-[28px] leading-tight font-semibold tracking-tight break-all tabular-nums">
            {formatUnits(BigInt(quote.sourceAmount), token.decimals)}{" "}
            <span className="text-muted">{token.symbol}</span>
          </p>
          <p className="mt-1 text-xs text-muted">
            ≈{formatMoney(quote.sourceUsdAmount, "USD")}
          </p>
        </>
      ) : (
        <p className="pt-1.5 text-sm text-muted">—</p>
      )}
    </div>
  </div>
);

const ItemThumb = ({ image }: { image?: string | null }) => {
  const placeholder = (
    <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-surface text-muted ring-1 ring-line">
      <IconLayersLinked className="size-5" strokeWidth={1.5} />
    </span>
  );

  return image ? (
    <SmartImage
      url={image}
      alt=""
      className="size-11 rounded-xl border-none object-cover ring-1 ring-line"
      fallbackComponent={() => placeholder}
    />
  ) : (
    placeholder
  );
};

const Footer = ({
  app,
  className,
}: {
  app: Checkout["app"];
  className?: string;
}) => (
  <footer
    className={cn("flex items-center gap-x-3 text-xs text-muted", className)}
  >
    {/* Required attribution: keep this notice and its link, see NOTICE.md (AGPL-3.0 section 7(b)). */}
    <a
      href="https://usekite.site"
      target="_blank"
      rel="noreferrer"
      className="flex items-center gap-1 transition-colors hover:text-ink"
    >
      <span>Powered by</span>
      <Logo className="gap-1 text-xs font-semibold text-ink/70 [&_img]:size-4" />
    </a>

    {(app.termsOfServiceUrl || app.privacyPolicyUrl) && (
      <span className="h-3 w-px bg-ink/15" />
    )}

    {app.termsOfServiceUrl && (
      <a
        href={app.termsOfServiceUrl}
        target="_blank"
        rel="noreferrer"
        className="transition-colors hover:text-ink"
      >
        Terms
      </a>
    )}

    {app.privacyPolicyUrl && (
      <a
        href={app.privacyPolicyUrl}
        target="_blank"
        rel="noreferrer"
        className="transition-colors hover:text-ink"
      >
        Privacy
      </a>
    )}
  </footer>
);

const Layout = ({
  left,
  right,
  footer,
}: {
  left: ReactNode;
  right: ReactNode;
  footer?: ReactNode;
}) => (
  <main className="mx-auto flex min-h-full w-full max-w-6xl flex-col gap-3 p-3 sm:p-4 lg:grid lg:grid-cols-2 lg:content-stretch lg:gap-4">
    <aside className="flex flex-col px-3 pt-5 pb-3 sm:px-8 sm:pt-8 lg:px-12 lg:pt-16 lg:pb-8">
      <div className="mx-auto flex w-full max-w-105 flex-1 flex-col">
        {left}
        {footer && (
          <div className="mt-auto hidden pt-12 lg:block">{footer}</div>
        )}
      </div>
    </aside>

    <section className="flex flex-1 flex-col rounded-[28px] bg-surface px-5 py-10 border border-line lg:px-12 lg:pt-16 lg:pb-8">
      <div className="mx-auto flex w-full max-w-105 flex-1 flex-col">
        {right}
      </div>
    </section>

    {footer && (
      <div className="mt-auto flex justify-center py-5 lg:hidden">{footer}</div>
    )}
  </main>
);

const Shell = ({
  checkout,
  cancel,
  children,
}: {
  checkout: Checkout;
  cancel?: { label: string; busy: boolean; onClick: () => void };
  children: ReactNode;
}) => {
  const { app, paymentLink: link } = checkout;

  const merchant = (
    <>
      {app.icon ? (
        <SmartImage
          url={app.icon}
          alt=""
          className="size-8 rounded-[10px] border-none"
          fallbackComponent={() => (
            <Monogram
              label={app.name}
              className="size-8 bg-none bg-ink text-xs"
            />
          )}
        />
      ) : (
        <Monogram label={app.name} className="size-8 bg-none bg-ink text-xs" />
      )}
      <span className="font-display text-[15px] font-semibold">{app.name}</span>
    </>
  );

  return (
    <Layout
      left={
        <>
          <div className="flex items-center gap-1">
            {cancel && (
              <button
                type="button"
                aria-label={cancel.label}
                title={cancel.label}
                onClick={cancel.onClick}
                disabled={cancel.busy}
                className="-ml-2 flex size-8 shrink-0 items-center justify-center rounded-full text-muted transition-colors hover:bg-soft hover:text-ink"
              >
                {cancel.busy ? (
                  <IconLoader2 className="size-4 animate-spin" />
                ) : (
                  <IconArrowLeft className="size-4" />
                )}
              </button>
            )}

            {app.websiteUrl ? (
              <a
                href={app.websiteUrl}
                target="_blank"
                rel="noreferrer"
                className="flex w-max items-center gap-2"
              >
                {merchant}
              </a>
            ) : (
              <div className="flex items-center gap-2">{merchant}</div>
            )}
          </div>

          <div className="mt-8 lg:mt-14">
            <p className="text-[15px] text-muted">{link.title}</p>
            <h1 className="mt-1 font-display text-5xl font-semibold tracking-tight tabular-nums">
              {formatMoney(link.amount, link.currency)}
            </h1>
          </div>

          <ul className="mt-8 space-y-4">
            {link.lineItems?.map((item, index) => (
              <li key={index} className="flex items-center gap-3">
                <ItemThumb image={item.image} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{item.name}</p>
                  <p className="text-[11px] text-muted">
                    Qty {item.quantity}
                    {item.quantity > 1 &&
                      ` x ${formatMoney(item.price, link.currency)}`}
                  </p>
                </div>

                <p className="text-sm font-medium tabular-nums">
                  {formatMoney(
                    Number(item.price) * item.quantity,
                    link.currency,
                  )}
                </p>
              </li>
            ))}
          </ul>

          <div className="mt-6 flex items-center justify-between border-t border-ink/10 pt-4 font-display font-medium">
            <p>Total due</p>
            <p className="tabular-nums">
              {formatMoney(link.amount, link.currency)}
            </p>
          </div>
        </>
      }
      right={children}
      footer={<Footer app={app} />}
    />
  );
};

const TokenRow = ({
  token,
  action,
  onClick,
}: {
  token: Token;
  action?: ReactNode;
  onClick: () => void;
}) => (
  <button
    type="button"
    onClick={onClick}
    className="flex w-full items-center gap-2 rounded-xl px-2 py-2.5 text-left font-sans transition-colors hover:bg-soft"
  >
    <TokenIcon token={token} />
    <span className="min-w-0 flex-1">
      <span className="block truncate text-sm font-medium">{token.symbol}</span>
      <span className="block truncate text-[11px] text-muted">
        {token.name}
      </span>
    </span>

    {action ?? (
      <span className="text-xs text-muted">{shortAddress(token.address)}</span>
    )}
  </button>
);

const Empty = ({ title, text }: { title: string; text: string }) => (
  <div className="flex flex-col items-center px-6 py-10 text-center">
    <span className="flex size-12 items-center justify-center rounded-full bg-soft text-muted">
      <IconSearch className="size-5" />
    </span>
    <p className="mt-4 text-[15px] font-medium">{title}</p>
    <p className="mt-1 text-[13px] text-muted">{text}</p>
  </div>
);

const TokenStep = ({
  chains,
  chain,
  imported,
  onBack,
  onChain,
  onPick,
  onImport,
}: {
  chains: CheckoutChain[];
  chain: CheckoutChain;
  imported: Token[];
  onBack: () => void;
  onChain: (chainId: string) => void;
  onPick: (token: Token) => void;
  onImport: (token: Token) => void;
}) => {
  const [search, setSearch] = useState("");
  const query = search.trim();
  const needle = query.toLowerCase();
  const address = isAddress(query, { strict: false }) ? query : null;

  const matches = [...chain.tokens, ...imported].filter(
    (token) =>
      !needle ||
      token.symbol.toLowerCase().includes(needle) ||
      token.name.toLowerCase().includes(needle) ||
      token.address.toLowerCase().startsWith(needle),
  );
  const unknown = !!address && !matches.length;

  const lookup = useQuery({
    queryKey: ["checkout-token", chain.id, address?.toLowerCase()],
    queryFn: async (): Promise<Token> => {
      const response = await fetch(`/api/tokens/${chain.id}/${address}`);
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(failure(body, "Token not found"));

      const found = body as TokenWithChain;
      return {
        address: found.address,
        symbol: found.symbol,
        name: found.name,
        decimals: found.decimals,
        icon: found.icon,
        x402: false,
      };
    },
    enabled: unknown,
    staleTime: Infinity,
  });

  return (
    <div>
      <SheetHeader title="Select a token" onBack={onBack} />

      <div className="mt-6 flex gap-2">
        <label className="flex h-11 min-w-0 flex-1 items-center gap-2 rounded-xl bg-white px-3 border border-ink/20 ring-ink/10 transition-shadow focus-within:ring-2">
          <IconSearch className="size-4 shrink-0 text-muted" />
          <input
            autoFocus
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search or paste address"
            spellCheck={false}
            autoComplete="off"
            className="h-full min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted"
          />
        </label>
        <ChainSwitcher
          chains={chains}
          value={chain.id}
          onChange={onChain}
          compact
        />
      </div>

      <div className="mt-4 -mx-2 max-h-88 overflow-y-auto">
        {matches.map((token) => (
          <TokenRow
            key={token.address}
            token={token}
            onClick={() => onPick(token)}
          />
        ))}

        {unknown &&
          (lookup.isLoading ? (
            <div className="flex items-center gap-3 px-2 py-2.5">
              <Skeleton className="size-9 shrink-0" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-3.5 w-16" />
                <Skeleton className="h-3 w-28" />
              </div>
            </div>
          ) : lookup.data ? (
            <TokenRow
              token={lookup.data}
              onClick={() => onImport(lookup.data)}
              action={
                <span className="rounded-full bg-ink px-3.75 py-1.75 font-display text-xs font-medium text-white">
                  Import
                </span>
              }
            />
          ) : (
            <Empty
              title="No token at this address"
              text={`Check that it's a token contract on ${chain.name}.`}
            />
          ))}

        {!matches.length && !address && (
          <Empty
            title="No tokens found"
            text="Paste the token's contract address to import it."
          />
        )}
      </div>

      {unknown && lookup.data && (
        <p className="mt-3 flex items-center gap-2 rounded-xl bg-blue-50 px-3.5 py-3 text-[13px] text-blue-700 border border-blue-200">
          <IconInfoCircle className="size-4 shrink-0" />
          Anyone can create a token, including copies of real ones. Make sure
          this is the one you meant to pay with.
        </p>
      )}
    </div>
  );
};

// EIP-681 payment URI so scanning wallets pre-fill token, chain and amount.
// Amounts are in base units; the zero address means the chain's native coin.
const paymentUri = (
  pay: CreatedTransfer["paymentInstructions"],
  chainId: number,
) =>
  /^0x0{40}$/i.test(pay.tokenAddress)
    ? `ethereum:${pay.address}@${chainId}?value=${pay.amount}`
    : `ethereum:${pay.tokenAddress}@${chainId}/transfer?address=${pay.address}&uint256=${pay.amount}`;

const InstructionsStep = ({
  transfer,
  chain,
  token,
}: {
  transfer: CreatedTransfer;
  chain: CheckoutChain;
  token: Token;
}) => {
  const pay = transfer.paymentInstructions;
  const amount = formatUnits(BigInt(pay.amount), token.decimals);
  const [view, setView] = useState<"address" | "qr">("qr");

  return (
    <div>
      <SheetHeader
        title="Send payment"
        accessory={
          <span className="inline-flex items-center gap-1 rounded-full bg-soft px-2.5 py-1 text-xs font-medium">
            <IconClockHour4 className="size-3.5 text-muted" />
            <Countdown until={pay.expiresAt} />
          </span>
        }
      />

      <div className="mt-8 text-center">
        <p className="text-sm text-muted">Send exactly</p>
        <p className="mt-1 font-display text-4xl font-semibold tracking-tight break-all tabular-nums">
          {amount} <span className="text-muted">{token.symbol}</span>
        </p>
        <CopyButton
          value={amount}
          label="Copy"
          variant="secondary"
          className="mt-4"
        />
      </div>

      <div className="mt-8 rounded-2xl bg-soft p-4">
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs font-medium text-muted">To this address</p>
          <div className="flex gap-0.5 rounded-full bg-ink/5 p-0.5">
            {(["qr", "address"] as const).map((item) => (
              <button
                key={item}
                type="button"
                aria-pressed={view === item}
                onClick={() => setView(item)}
                className={cn(
                  "rounded-full px-3 py-1 text-xs font-medium transition-colors",
                  view === item
                    ? "bg-white text-ink shadow-sm"
                    : "text-muted hover:text-ink",
                )}
              >
                {item === "qr" ? "QR code" : "Address"}
              </button>
            ))}
          </div>
        </div>
        {view === "qr" ? (
          <div className="mt-3 flex flex-col items-center gap-2">
            <div className="rounded-xl bg-white p-3">
              <QRCodeSVG
                value={paymentUri(pay, chain.chainId)}
                size={176}
                marginSize={0}
                title={pay.address}
              />
            </div>
            <p className="text-xs text-muted">{shortAddress(pay.address)}</p>
          </div>
        ) : (
          <p className="mt-1.5 text-[13px] leading-relaxed break-all">
            {pay.address}
          </p>
        )}
        <CopyButton
          value={pay.address}
          label="Copy"
          variant="outline"
          className="mt-3"
        />
      </div>

      <Rows className="mt-5">
        <Row label="Network">
          <ChainLabel chain={chain} />
        </Row>
        <Row label="Token">
          <TokenIcon token={token} className="size-5 text-[10px]" />
          {token.symbol}
          <span className="text-xs font-normal text-muted">
            {shortAddress(token.address)}
          </span>
          <CopyButton value={token.address} className="-mx-2" />
        </Row>
      </Rows>

      <p className="mt-3 flex items-center gap-2 rounded-xl bg-blue-50 px-3.5 py-3 text-[13px] text-blue-700 border border-blue-200">
        <IconInfoCircle className="size-4 shrink-0" />
        <span>
          Only send {token.symbol} on {chain.name}. Other tokens or networks
          can't be recovered
        </span>
      </p>
    </div>
  );
};

const StatusStep = ({
  checkout,
  chain,
  transferId,
  txHash,
  returnUrl,
  onRestart,
}: {
  checkout: Checkout;
  chain?: CheckoutChain;
  transferId: string;
  txHash?: string;
  returnUrl: string | null;
  onRestart: () => void;
}) => {
  const now = useNow();
  const { data } = useQuery({
    ...checkoutGetTransferOptions({
      path: { id: checkout.paymentLink.id, transferId },
    }),
    refetchInterval: (query) =>
      Final.includes(query.state.data?.status ?? "") ? false : 4000,
  });

  const expired =
    !!data &&
    Waiting.includes(data.status) &&
    new Date(data.expiresAt).getTime() <= now;
  const hash =
    data?.settlementBlockchainHash ?? data?.x402BlockchainHash ?? txHash;
  const explorer =
    chain?.blockExplorer && hash
      ? `${chain.blockExplorer.url}/tx/${hash}`
      : undefined;

  const view = statusView(data, expired, checkout.app.name);
  const canRestart =
    expired || data?.status === "Failed" || data?.status === "Cancelled";

  const status = data?.status;
  useEffect(() => {
    if (!status) return;

    notify({ type: "status", transferId, status });
    if (status === "Settled") notify({ type: "success", transferId });
    else if (["Refunded", "Failed", "Cancelled"].includes(status)) {
      notify({ type: "failed", transferId, reason: status.toLowerCase() });
    }
  }, [status, transferId]);

  useEffect(() => {
    if (expired) notify({ type: "failed", transferId, reason: "expired" });
  }, [expired, transferId]);

  const outcome = outcomeOf(status, expired);
  const back =
    returnUrl && outcome && !embedded
      ? returnTo(returnUrl, outcome, transferId)
      : null;

  // A completed payment heads back to the merchant by itself.
  useEffect(() => {
    if (outcome !== "completed" || !back) return;

    const timer = setTimeout(() => window.location.assign(back), 5000);
    return () => clearTimeout(timer);
  }, [outcome, back]);

  return (
    <div className="h-full flex flex-col justify-between">
      <div className="flex flex-col items-center py-10 text-center">
        <span
          key={view.title}
          className={cn(
            "flex size-18 animate-[pop-in_360ms_cubic-bezier(0.2,0.9,0.3,1.3)] items-center justify-center rounded-full",
            view.tone,
          )}
        >
          {view.icon}
        </span>
        <h2 className="mt-6 text-2xl font-semibold tracking-tight">
          {view.title}
        </h2>
        {view.text && (
          <p className="mt-2 max-w-xs text-sm text-muted">{view.text}</p>
        )}

        {explorer && (
          <a
            href={explorer}
            target="_blank"
            rel="noreferrer"
            className="mt-7 inline-flex items-center gap-1 rounded-full bg-soft px-4 py-2 font-display text-sm font-medium transition-colors hover:bg-line"
          >
            View transaction <IconArrowUpRight className="size-4" />
          </a>
        )}
      </div>

      {(canRestart || back) && (
        <div className="mt-8 space-y-2">
          {canRestart && <Primary onClick={onRestart}>Start over</Primary>}
          {back && (
            <Primary
              variant={canRestart ? "secondary" : undefined}
              onClick={() => window.location.assign(back)}
            >
              Return to {checkout.app.name}
            </Primary>
          )}
        </div>
      )}
    </div>
  );
};

const statusView = (
  data: CheckoutTransfer | undefined,
  expired: boolean,
  appName: string,
): { icon: ReactNode; tone: string; title: string; text?: string } => {
  if (!data) {
    return {
      icon: <IconLoader2 className="size-8 animate-spin" />,
      tone: "bg-soft text-muted",
      title: "Checking payment…",
    };
  }

  if (data.status === "Settled") {
    return {
      icon: <IconCircleCheckFilled className="size-10" />,
      tone: "bg-success/10 text-success",
      title: "Payment complete",
      text: `${appName} has received your payment.`,
    };
  }

  if (data.status === "Refunded") {
    return {
      icon: <IconArrowBackUp className="size-9" />,
      tone: "bg-warning/15 text-amber-600",
      title: "Payment refunded",
      text: "Your payment couldn't be completed and was sent back to your refund address.",
    };
  }

  if (data.status === "Failed" || data.status === "Cancelled") {
    return {
      icon: <IconCircleXFilled className="size-10" />,
      tone: "bg-danger/10 text-danger",
      title: "Payment failed",
      text: "This payment couldn't be completed.",
    };
  }

  if (expired) {
    return {
      icon: <IconClockHour4 className="size-9" />,
      tone: "bg-warning/15 text-amber-600",
      title: "Payment window closed",
      text: "No payment arrived in time. Anything sent late is returned to your refund address.",
    };
  }

  if (Waiting.includes(data.status)) {
    return {
      icon: <IconLoader2 className="size-8 animate-spin" />,
      tone: "bg-brand-soft text-brand",
      title: "Waiting for your payment",
      text: "This updates by itself once your payment is seen on chain.",
    };
  }

  return {
    icon: <IconLoader2 className="size-8 animate-spin" />,
    tone: "bg-brand-soft text-brand",
    title: "Payment received",
    text: "We're finalising it now. You can close this page.",
  };
};

const Loading = () => (
  <Layout
    left={
      <div
        aria-busy="true"
        aria-label="Loading"
        className="[&_.animate-pulse]:bg-ink/6"
      >
        <div className="flex items-center gap-2.5">
          <Skeleton className="size-8 rounded-[10px]" />
          <Skeleton className="h-4 w-24" />
        </div>
        <Skeleton className="mt-8 h-4 w-32 lg:mt-14" />
        <Skeleton className="mt-3 h-12 w-44 rounded-xl" />
        <div className="mt-8 space-y-4">
          {[0, 1].map((index) => (
            <div key={index} className="flex items-center gap-3">
              <Skeleton className="size-11 rounded-xl" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-3.5 w-28" />
                <Skeleton className="h-3 w-12" />
              </div>
            </div>
          ))}
        </div>
      </div>
    }
    right={
      <div className="space-y-3">
        <Skeleton className="h-7 w-56 rounded-lg" />
        <Skeleton className="h-4 w-40" />
        <Skeleton className="mt-6 h-36 w-full rounded-2xl" />
      </div>
    }
  />
);

export const Pay = () => (
  <>
    <PayFlow />
    {embedded && (
      <button
        type="button"
        aria-label="Close"
        onClick={() => notify({ type: "close" })}
        className="fixed top-3 right-3 z-10 flex size-10 items-center justify-center rounded-full bg-surface text-ink shadow-sm transition-colors hover:bg-soft"
      >
        <IconX className="size-5" />
      </button>
    )}
  </>
);

const PayFlow = () => {
  const { id = "" } = useParams();
  const queryClient = useQueryClient();
  const checkout = useQuery({
    ...checkoutGetOptions({ path: { id } }),
    enabled: /^[0-9a-f-]{36}$/i.test(id),
  });

  const loadedId = checkout.data?.paymentLink.id;
  const missing = !checkout.isLoading && !checkout.data;
  useEffect(() => {
    if (loadedId) notify({ type: "ready", paymentLinkId: loadedId });
  }, [loadedId]);
  useEffect(() => {
    if (missing) notify({ type: "failed", reason: "not_found" });
  }, [missing]);

  const [step, setStep] = useState<Step>({ kind: "method" });
  const [chainId, setChainId] = useState("");
  const [token, setToken] = useState<Token | null>(null);
  const [imported, setImported] = useState<Record<string, Token[]>>({});
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [account, setAccount] = useState<Address | null>(null);
  const [refundAddress, setRefundAddress] = useState("");
  // the transfer this page opened that nobody has paid yet
  const [openedId, setOpenedId] = useState<string | null>(null);
  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState<string | null>(null);

  const chains = useMemo(() => checkout.data?.chains ?? [], [checkout.data]);
  const chain = chains.find((item) => item.id === chainId) ?? chains[0];

  const payToken =
    step.kind === "wallet" || step.kind === "review" ? token : null;

  const quote = useQuery({
    queryKey: ["checkout-quote", id, chain?.id, payToken?.address],
    queryFn: async () => {
      const { data } = await checkoutQuote({
        path: { id },
        body: { chainId: chain!.id, sourceTokenAddress: payToken!.address },
      });
      return data;
    },
    enabled: !!chain && !!payToken,
    staleTime: Infinity,
    gcTime: 0,
  });

  const now = useNow();
  const quoteExpired =
    !!quote.data && new Date(quote.data.expiresAt).getTime() <= now;

  const transferPoll = useQuery({
    ...checkoutGetTransferOptions({
      path: {
        id,
        transferId: step.kind === "instructions" ? step.transfer.id : "",
      },
    }),
    enabled: step.kind === "instructions",
    refetchInterval: 4000,
  });

  const opened = step.kind === "instructions" ? step.transfer : null;
  useEffect(() => {
    if (opened) {
      notify({
        type: "status",
        transferId: opened.id,
        status: opened.status,
      });
    }
  }, [opened]);

  // Hand over to the status view once the deposit is seen, or once the
  // window to pay has closed.
  const windowClosed =
    step.kind === "instructions" &&
    new Date(step.transfer.paymentInstructions.expiresAt).getTime() <= now;
  useEffect(() => {
    const status = transferPoll.data?.status;
    if (
      step.kind === "instructions" &&
      ((status && !Waiting.includes(status)) || windowClosed)
    ) {
      setStep({ kind: "status", transferId: step.transfer.id });
    }
  }, [transferPoll.data?.status, step, windowClosed]);

  const go = (next: Step) => {
    setError(null);
    setStep(next);
  };

  const run = async (
    on: string,
    task: (progress: (label: string) => void) => Promise<void>,
  ) => {
    setError(null);
    setBusy({ on, label: "" });
    try {
      await task((label) => setBusy({ on, label }));
    } catch (e) {
      setError(walletMessage(e));
    } finally {
      setBusy(null);
    }
  };

  const restart = () => {
    setToken(null);
    setWallet(null);
    setAccount(null);
    setOpenedId(null);
    go({ kind: "method" });
    // The next attempt prices afresh.
    queryClient.removeQueries({ queryKey: ["checkout-quote"] });
  };

  const connectTo = async (
    choice: Wallet,
    progress: (label: string) => void,
  ) => {
    progress(`Waiting for ${choice.name}…`);
    const address = await connectWallet(choice);
    const current = await choice.provider
      .request({ method: "eth_chainId" })
      .then(Number)
      .catch(() => 0);
    const start = chains.find((item) => item.chainId === current) ?? chains[0];

    setWallet(choice);
    setAccount(address);
    setChainId(start.id);
    setToken(null);
    setStep({ kind: "token" });
  };

  const chooseWallet = () =>
    run("wallet", async (progress) => {
      progress("Looking for wallets…");
      const found = await discoverWallets();

      if (found.length === 1) await connectTo(found[0], progress);
      else setStep({ kind: "wallets", wallets: found });
    });

  const openTransfer = async (q: Quote, refund: string) => {
    const { data } = await checkoutOpenTransfer({
      path: { id },
      body: { quoteId: q.id, refundAddress: refund },
    });
    setOpenedId(data.id);
    return data;
  };

  const returnUrl = checkout.data?.paymentLink.returnUrl ?? null;

  // Leaves the checkout; an open transfer is cancelled first so it can't be
  // paid later.
  const cancel = () =>
    run("cancel", async (progress) => {
      progress("Cancelling…");
      if (openedId) {
        await checkoutCancelTransfer({
          path: { id, transferId: openedId },
        });
      }

      if (returnUrl) {
        window.location.assign(
          returnTo(returnUrl, "cancelled", openedId ?? undefined),
        );
        return;
      }

      restart();
    });

  // The wallet sends the chosen token straight to the transfer's pay-in
  // address; refunds go back to it.
  const payWithWallet = (q: Quote) =>
    run("pay", async (progress) => {
      if (!wallet || !account || !chain) return;

      progress(`Switching to ${chain.name}…`);
      await switchChain(wallet, chain);

      progress("Preparing payment…");
      const transfer = await openTransfer(q, account);
      const { address, tokenAddress, amount } = transfer.paymentInstructions;

      progress("Confirm in your wallet…");
      const txHash = await sendToken(
        wallet,
        account,
        chain,
        tokenAddress,
        address,
        amount,
      );

      setStep({ kind: "status", transferId: transfer.id, txHash });
    });

  const showInstructions = (q: Quote) =>
    run("pay", async (progress) => {
      if (!chain || !token) return;

      progress("Preparing payment details…");
      const transfer = await openTransfer(q, refundAddress.trim());
      setStep({ kind: "instructions", transfer });
    });

  const pickToken = (picked: Token) => {
    setToken(picked);
    go({ kind: wallet ? "wallet" : "review" });
  };

  const importToken = (found: Token) => {
    if (chain) {
      setImported((current) => ({
        ...current,
        [chain.id]: [...(current[chain.id] ?? []), found],
      }));
    }
    pickToken(found);
  };

  // The one button under a quote: refreshes the price when it can't pay yet.
  const quoteButton = (label: string, onPay: (q: Quote) => void) => {
    const busyLabel = busy?.on === "pay" ? busy.label : null;

    if (quote.isFetching) {
      return <Primary busy />;
    }

    if (quote.error || quoteExpired) {
      return (
        <Primary variant="secondary" onClick={() => quote.refetch()}>
          {quote.error ? "Try again" : "Refresh price"}
        </Primary>
      );
    }

    return (
      <Primary
        busy={!!busyLabel}
        disabled={!quote.data || !!busy}
        onClick={() => quote.data && onPay(quote.data)}
      >
        {label}
      </Primary>
    );
  };

  if (checkout.isLoading) return <Loading />;

  if (!checkout.data) {
    return (
      <div className="flex min-h-full flex-col items-center justify-center px-6 text-center">
        <span className="flex size-16 items-center justify-center rounded-full bg-surface text-muted shadow-sm">
          <IconPaywall strokeWidth={1.5} className="size-8" />
        </span>
        <h1 className="mt-6 text-2xl font-semibold tracking-tight">
          {checkout.error?.message ?? "Invalid link"}
        </h1>
      </div>
    );
  }

  const { app } = checkout.data;
  let body: ReactNode;

  if (step.kind === "method") {
    body = (
      <div>
        <h2 className="text-2xl font-semibold tracking-tight">
          How would you like to pay?
        </h2>

        {chains.length ? (
          <div className="mt-7">
            <Group>
              <Option
                icon={
                  <IconTile className="bg-ink">
                    <IconWallet />
                  </IconTile>
                }
                title="Connect wallet"
                onClick={chooseWallet}
                disabled={!!busy}
                busy={busy?.on === "wallet"}
              />
              <Option
                icon={
                  <IconTile className="bg-pending">
                    <IconPaywall />
                  </IconTile>
                }
                title="Payment instructions"
                onClick={() => go({ kind: "token" })}
                disabled={!!busy}
              />
            </Group>

            {error && <ErrorNote className="mt-4">{error}</ErrorNote>}
          </div>
        ) : (
          <ErrorNote className="mt-7">
            <div className="space-y-2">
              <p>This link can't be paid right now.</p>
              <div>
                <p className="font-medium">I am the site administrator</p>
                <p>Kindly ensure you have atleast one chain configured</p>
              </div>
              <div>
                <p className="font-medium">I am not the site administrator</p>
                <p>
                  Reach out to site administrator on how to resolve this issue
                </p>
              </div>
            </div>
          </ErrorNote>
        )}
      </div>
    );
  } else if (step.kind === "wallets") {
    body = (
      <div>
        <SheetHeader
          title="Connect wallet"
          onBack={() => go({ kind: "method" })}
        />

        {step.wallets.length ? (
          <div className="mt-6">
            <Group>
              {step.wallets.map((item) => (
                <Option
                  key={item.id}
                  icon={
                    item.icon ? (
                      <img
                        src={item.icon}
                        alt=""
                        className="size-10 shrink-0 rounded-xl"
                      />
                    ) : (
                      <IconTile className="bg-ink">
                        <IconWallet />
                      </IconTile>
                    )
                  }
                  title={item.name}
                  onClick={() =>
                    run(item.id, (progress) => connectTo(item, progress))
                  }
                  disabled={!!busy}
                  busy={busy?.on === item.id}
                />
              ))}
            </Group>
            {error && <ErrorNote className="mt-4">{error}</ErrorNote>}
          </div>
        ) : (
          <div className="flex flex-col items-center py-12 text-center">
            <IconTile className="size-14 rounded-full bg-soft text-muted [&_svg]:size-7">
              <IconWallet />
            </IconTile>
            <p className="mt-5 text-lg font-semibold">No wallet found</p>
            <p className="mt-1.5 max-w-xs text-sm text-muted">
              Install a browser wallet and reload this page, or pay with
              instructions instead
            </p>
            <Button
              className="mt-7 h-11 px-5"
              onClick={() => go({ kind: "token" })}
            >
              Use payment instructions
            </Button>
          </div>
        )}
      </div>
    );
  } else if (step.kind === "wallet" && chain && token && wallet && account) {
    body = (
      <>
        <div>
          <SheetHeader
            title="Pay with wallet"
            onBack={() => go({ kind: "token" })}
          />

          <div className="mt-8 flex flex-col items-center justify-center border border-line p-4 text-center space-y-px rounded-2xl">
            <p className="font-sans text-sm text-muted">Quote expires in:</p>
            {!quote.data ? (
              <Skeleton className="h-9 w-24 mt-3 rounded-lg" />
            ) : (
              <p className="font-display text-5xl">
                <Countdown until={quote.data?.expiresAt} />
              </p>
            )}
          </div>

          <Rows className="mt-6">
            <Row label="Wallet">
              {wallet.icon ? (
                <img src={wallet.icon} alt="" className="size-5 rounded-md" />
              ) : (
                <IconWallet className="size-4 text-muted" />
              )}

              <span className="text-[13px]">{shortAddress(account)}</span>
            </Row>
            <Row label="Network">
              <ChainLabel chain={chain} />
            </Row>
            <Row label="Pay with" onClick={() => go({ kind: "token" })}>
              <TokenIcon token={token} className="size-5 text-[10px]" />
              {token.symbol}
            </Row>
          </Rows>

          <Total
            label={`Pay ${app.name}`}
            token={token}
            quote={quote.data}
            loading={quote.isFetching}
          />

          {quote.error && (
            <ErrorNote className="mb-4">{quote.error.message}</ErrorNote>
          )}

          {error && <ErrorNote className="mb-4">{error}</ErrorNote>}
        </div>

        {quoteButton(`Pay with ${wallet.name}`, payWithWallet)}
      </>
    );
  } else if (step.kind === "token" && chain) {
    body = (
      <TokenStep
        chains={chains}
        chain={chain}
        imported={imported[chain.id] ?? []}
        onBack={() => {
          setWallet(null);
          setAccount(null);
          go({ kind: "method" });
        }}
        onChain={(next) => {
          setChainId(next);
          setToken(null);
        }}
        onPick={pickToken}
        onImport={importToken}
      />
    );
  } else if (step.kind === "review" && chain && token) {
    const refund = refundAddress.trim();
    const refundValid = isAddress(refund);

    body = (
      <>
        <div>
          <SheetHeader title="Review" onBack={() => go({ kind: "token" })} />

          <div className="mt-8 flex flex-col items-center justify-center border border-line p-4 text-center space-y-px rounded-2xl">
            <p className="font-sans text-sm text-muted">Quote expires in:</p>
            {!quote.data ? (
              <Skeleton className="h-9 w-24 mt-3 rounded-lg" />
            ) : (
              <p className="font-display text-5xl">
                <Countdown until={quote.data?.expiresAt} />
              </p>
            )}
          </div>

          <Rows className="mt-6">
            <Row label="Pay with" onClick={() => go({ kind: "token" })}>
              <TokenIcon token={token} className="size-5 text-[10px]" />
              {token.symbol}
            </Row>
            <Row label="Network">
              <ChainLabel chain={chain} />
            </Row>
          </Rows>

          <Total
            label={`Pay ${app.name}`}
            token={token}
            quote={quote.data}
            loading={quote.isFetching}
          />

          <Field
            label="Refund address"
            hint="If the payment can't be completed, your funds are sent here. Use a wallet you control, not an exchange deposit address."
          >
            <Input
              value={refundAddress}
              onChange={(event) => setRefundAddress(event.target.value)}
              spellCheck={false}
              className="h-10.5"
              autoComplete="off"
            />
          </Field>

          {quote.error && (
            <ErrorNote className="mt-5">{quote.error.message}</ErrorNote>
          )}

          {error && <ErrorNote className="mt-5">{error}</ErrorNote>}
        </div>

        <div className="mt-6">
          {refundValid || quote.error || quoteExpired || quote.isFetching ? (
            quoteButton("Show payment details", showInstructions)
          ) : (
            <Primary disabled>Show payment details</Primary>
          )}
        </div>
      </>
    );
  } else if (step.kind === "instructions" && chain && token) {
    body = (
      <div>
        <InstructionsStep
          transfer={step.transfer}
          chain={chain}
          token={token}
        />
        {error && <ErrorNote className="mt-4">{error}</ErrorNote>}
      </div>
    );
  } else if (step.kind === "status") {
    body = (
      <StatusStep
        checkout={checkout.data}
        chain={chain}
        transferId={step.transferId}
        txHash={step.txHash}
        returnUrl={returnUrl}
        onRestart={restart}
      />
    );
  }

  return (
    <Shell
      checkout={checkout.data}
      cancel={
        // embeds are left to the page around them; a sent payment can't be undone
        !embedded &&
        step.kind !== "status" &&
        (!!returnUrl || step.kind !== "method")
          ? {
              label: returnUrl ? `Back to ${app.name}` : "Cancel payment",
              busy: busy?.on === "cancel",
              onClick: cancel,
            }
          : undefined
      }
    >
      <div
        key={step.kind}
        className="h-full flex flex-col justify-between animate-[rise-in_260ms_cubic-bezier(0.2,0.8,0.2,1)]"
      >
        {body}
      </div>
    </Shell>
  );
};
