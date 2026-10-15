import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  IconAlertTriangle,
  IconArrowBackUp,
  IconArrowLeft,
  IconBolt,
  IconCircleCheck,
  IconCircleX,
  IconExternalLink,
  IconFileText,
  IconLoader2,
  IconWallet,
} from "@tabler/icons-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useParams } from "react-router-dom";
import { formatUnits, isAddress, type Address } from "viem";
import {
  getApiCheckoutByIdOptions,
  getApiCheckoutByIdTransferByTransferIdOptions,
} from "@/api/@tanstack/react-query.gen";
import {
  postApiCheckoutByIdQuote,
  postApiCheckoutByIdTransfer,
  postApiCheckoutByIdX402,
  postApiCheckoutByIdX402Settle,
} from "@/api/sdk.gen";
import type { Checkout, CreatedTransfer, Quote } from "@/api/types.gen";
import { CopyButton } from "@/components/copy-button";
import { Field } from "@/components/field";
import { Logo } from "@/components/logo";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/input";
import { shortAddress } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  connectWallet,
  discoverWallets,
  sendToken,
  signX402Payment,
  switchChain,
  walletMessage,
  type CheckoutChain,
  type Wallet,
} from "@/lib/wallet";

type Token = CheckoutChain["tokens"][number];

type Step =
  | { kind: "details" }
  | { kind: "method" }
  | { kind: "pay"; method: "wallet" | "manual" }
  | { kind: "instructions"; transfer: CreatedTransfer }
  | { kind: "tracking"; transferId: string; txHash?: string };

const Pending = ["AwaitingDeposit"];
const Final = ["Settled", "Refunded", "Failed", "Cancelled"];

const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));

const formatMoney = (amount: string, currency: string) => {
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
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
    <span className={cn("tabular-nums", left < 60_000 && "text-warning")}>
      {minutes}:{seconds.toString().padStart(2, "0")}
    </span>
  );
};

const Row = ({ label, children }: { label: string; children: ReactNode }) => (
  <div className="flex items-start justify-between gap-4 py-2 text-sm">
    <span className="shrink-0 text-muted">{label}</span>
    <span className="min-w-0 text-right">{children}</span>
  </div>
);

const Choice = ({
  icon,
  title,
  description,
  onClick,
  disabled,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  onClick: () => void;
  disabled?: boolean;
}) => (
  <button
    type="button"
    disabled={disabled}
    onClick={onClick}
    className="flex w-full items-center gap-3 rounded-xl border border-line p-4 text-left transition-colors hover:bg-soft disabled:opacity-50"
  >
    <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-soft">
      {icon}
    </span>
    <span>
      <span className="block text-sm font-medium">{title}</span>
      <span className="block text-xs text-muted">{description}</span>
    </span>
  </button>
);

const ErrorNote = ({ children }: { children: ReactNode }) => (
  <p className="flex items-start gap-2 rounded-xl bg-danger/10 p-3 text-sm text-danger">
    <IconAlertTriangle className="mt-0.5 size-4 shrink-0" />
    <span>{children}</span>
  </p>
);

const Summary = ({ checkout }: { checkout: Checkout }) => {
  const { paymentLink: link, app } = checkout;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        {app.icon ? (
          <img
            src={app.icon}
            alt=""
            className="size-10 rounded-full border border-line object-cover"
          />
        ) : (
          <span className="flex size-10 items-center justify-center rounded-full bg-soft font-display font-semibold">
            {app.name.slice(0, 1).toUpperCase()}
          </span>
        )}
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{app.name}</p>
          <h1 className="truncate text-lg font-semibold">{link.title}</h1>
        </div>
      </div>

      <p className="font-display text-4xl font-semibold tracking-tight">
        {formatMoney(link.amount, link.currency)}
      </p>

      {!!link.lineItems?.length && (
        <div className="divide-y divide-line rounded-xl border border-line">
          {link.lineItems.map((item, index) => (
            <div key={index} className="flex items-center gap-3 p-3 text-sm">
              {item.image && (
                <img
                  src={item.image}
                  alt=""
                  className="size-10 rounded-lg object-cover"
                />
              )}
              <span className="min-w-0 flex-1 truncate">
                {item.name}
                {item.quantity > 1 && (
                  <span className="text-muted"> × {item.quantity}</span>
                )}
              </span>
              <span>{formatMoney(item.price, link.currency)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

const Status = ({
  checkout,
  chain,
  transferId,
  txHash,
  onRestart,
}: {
  checkout: Checkout;
  chain?: CheckoutChain;
  transferId: string;
  txHash?: string;
  onRestart: () => void;
}) => {
  const { data } = useQuery({
    ...getApiCheckoutByIdTransferByTransferIdOptions({
      path: { id: checkout.paymentLink.id, transferId },
    }),
    refetchInterval: (query) =>
      Final.includes(query.state.data?.status ?? "") ? false : 4000,
  });

  const expired =
    data &&
    Pending.includes(data.status) &&
    new Date(data.expiresAt).getTime() < Date.now();
  const hash =
    data?.settlementBlockchainHash ?? data?.x402BlockchainHash ?? txHash;
  const explorer =
    chain && hash ? `${chain.blockExplorer.url}/tx/${hash}` : undefined;

  const view = !data
    ? { icon: IconLoader2, tone: "text-muted", spin: true, title: "Loading…" }
    : data.status === "Settled"
      ? {
          icon: IconCircleCheck,
          tone: "text-success",
          title: "Payment complete",
          text: `${checkout.app.name} has received your payment.`,
        }
      : data.status === "Refunded"
        ? {
            icon: IconArrowBackUp,
            tone: "text-warning",
            title: "Payment refunded",
            text: "Your payment couldn't be completed and was sent back to your refund address.",
          }
        : data.status === "Failed" || data.status === "Cancelled"
          ? {
              icon: IconCircleX,
              tone: "text-danger",
              title: "Payment failed",
              text: "This payment couldn't be completed.",
            }
          : expired
            ? {
                icon: IconAlertTriangle,
                tone: "text-warning",
                title: "Payment window closed",
                text: "No payment arrived in time. Anything sent late is returned to your refund address.",
              }
            : Pending.includes(data.status)
              ? {
                  icon: IconLoader2,
                  tone: "text-brand",
                  spin: true,
                  title: "Waiting for your payment",
                  text: "This updates by itself once your payment is seen on chain.",
                }
              : {
                  icon: IconLoader2,
                  tone: "text-brand",
                  spin: true,
                  title: "Payment received",
                  text: "We're finalising it now; you can close this page.",
                };

  return (
    <div className="space-y-4 py-4 text-center">
      <view.icon
        className={cn(
          "mx-auto size-12",
          view.tone,
          "spin" in view && view.spin && "animate-spin",
        )}
      />
      <div>
        <h2 className="text-xl font-semibold">{view.title}</h2>
        {"text" in view && (
          <p className="mt-1 text-sm text-muted">{view.text}</p>
        )}
      </div>
      {explorer && (
        <a
          href={explorer}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 text-sm text-brand hover:underline"
        >
          View transaction <IconExternalLink className="size-3.5" />
        </a>
      )}
      {(expired ||
        data?.status === "Failed" ||
        data?.status === "Cancelled") && (
        <Button variant="secondary" className="w-full" onClick={onRestart}>
          Start over
        </Button>
      )}
    </div>
  );
};

const Instructions = ({
  transfer,
  chain,
  token,
}: {
  transfer: CreatedTransfer;
  chain: CheckoutChain;
  token: Token;
}) => {
  const { paymentInstructions: pay } = transfer;
  const amount = formatUnits(BigInt(pay.amount), token.decimals);

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Send your payment</h2>
        <p className="mt-1 text-sm text-muted">
          Send exactly this amount from any wallet or exchange.
        </p>
      </div>

      <div className="divide-y divide-line rounded-xl border border-line px-4">
        <Row label="Network">{chain.name}</Row>
        <Row label="Token">
          <span className="flex items-center justify-end gap-1">
            {token.symbol}
            <span className="font-mono text-xs text-muted">
              {shortAddress(token.address)}
            </span>
            <CopyButton value={token.address} />
          </span>
        </Row>
        <Row label="Amount">
          <span className="flex items-center justify-end gap-1 font-medium">
            <span className="break-all">
              {amount} {token.symbol}
            </span>
            <CopyButton value={amount} />
          </span>
        </Row>
        <Row label="To address">
          <span className="flex items-center justify-end gap-1">
            <span className="break-all font-mono text-xs">{pay.address}</span>
            <CopyButton value={pay.address} />
          </span>
        </Row>
        <Row label="Pay within">
          <Countdown until={pay.expiresAt} />
        </Row>
      </div>

      <p className="flex items-start gap-2 rounded-xl bg-warning/10 p-3 text-xs text-warning">
        <IconAlertTriangle className="mt-0.5 size-4 shrink-0" />
        Only send {token.symbol} on {chain.name}. Other tokens or networks can't
        be recovered; late or short payments are refunded to{" "}
        {shortAddress(transfer.refundAddress)}.
      </p>
    </div>
  );
};

export const Pay = () => {
  const { id = "" } = useParams();
  const checkout = useQuery({
    ...getApiCheckoutByIdOptions({ path: { id } }),
    enabled: /^[0-9a-f-]{36}$/i.test(id),
  });

  const [step, setStep] = useState<Step>({ kind: "details" });
  const [wallets, setWallets] = useState<Wallet[] | null>(null);
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [account, setAccount] = useState<Address | null>(null);
  const [chainId, setChainId] = useState("");
  const [tokenAddress, setTokenAddress] = useState("");
  const [refundAddress, setRefundAddress] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const chains = useMemo(() => checkout.data?.chains ?? [], [checkout.data]);
  const chain = chains.find((c) => c.id === chainId);
  const token = chain?.tokens.find((t) => t.address === tokenAddress);

  // Start on the first network, with a gasless-capable token when there is
  // one: those are the stablecoins, which price without a swap.
  useEffect(() => {
    if (!chainId && chains[0]) setChainId(chains[0].id);
  }, [chains, chainId]);

  useEffect(() => {
    if (!chain) return;
    if (chain.tokens.some((t) => t.address === tokenAddress)) return;

    const preferred = chain.tokens.find((t) => t.x402) ?? chain.tokens[0];
    setTokenAddress(preferred?.address ?? "");
  }, [chain, tokenAddress]);

  const method = step.kind === "pay" ? step.method : null;

  const quote = useQuery({
    queryKey: ["checkout-quote", id, chainId, tokenAddress],
    queryFn: async () => {
      const { data } = await postApiCheckoutByIdQuote({
        path: { id },
        body: { chainId, sourceTokenAddress: tokenAddress },
      });
      return data;
    },
    enabled: step.kind === "pay" && !!chain && !!token,
    staleTime: Infinity,
    gcTime: 0,
  });

  const now = useNow();
  const quoteExpired =
    !!quote.data && new Date(quote.data.expiresAt).getTime() <= now;

  const queryClient = useQueryClient();
  const restart = () => {
    setStep({ kind: "details" });
    setError(null);
    setBusy(null);
    // The next attempt prices afresh.
    queryClient.removeQueries({ queryKey: ["checkout-quote"] });
  };

  const run = async (task: () => Promise<void>) => {
    setError(null);
    try {
      await task();
    } catch (e) {
      setError(walletMessage(e));
    } finally {
      setBusy(null);
    }
  };

  const chooseWallet = () =>
    run(async () => {
      setBusy("Looking for wallets…");
      setWallets(await discoverWallets());
    });

  const connect = (choice: Wallet) =>
    run(async () => {
      setBusy(`Connecting ${choice.name}…`);
      const address = await connectWallet(choice);
      setWallet(choice);
      setAccount(address);
      setRefundAddress(address);
      setStep({ kind: "pay", method: "wallet" });
    });

  const payWithWallet = (q: Quote) =>
    run(async () => {
      if (!wallet || !account || !chain || !token) return;

      setBusy(`Switching to ${chain.name}…`);
      await switchChain(wallet, chain);

      if (token.x402) {
        setBusy("Preparing payment…");
        const { data: payment } = await postApiCheckoutByIdX402({
          path: { id },
          body: { quoteId: q.id, refundAddress: account },
        });

        const validBefore =
          Math.floor(Date.now() / 1000) +
          payment.requirements.maxTimeoutSeconds;

        setBusy("Sign the payment in your wallet…");
        const paymentPayload = await signX402Payment(
          wallet,
          account,
          chain,
          payment.requirements,
          validBefore,
        );

        setBusy("Submitting payment…");
        for (let attempt = 0; attempt < 10; attempt++) {
          const { data: result } = await postApiCheckoutByIdX402Settle({
            path: { id },
            body: {
              paymentPayload,
              paymentRequirements: payment.requirements,
            },
          });

          if (result.success) break;
          if (result.errorReason !== "settlement_pending") {
            throw new Error(
              result.errorMessage ??
                result.errorReason ??
                "The payment wasn't accepted",
            );
          }

          await sleep(3000);
        }

        setStep({ kind: "tracking", transferId: payment.transfer.id });
        return;
      }

      setBusy("Preparing payment…");
      const { data: transfer } = await postApiCheckoutByIdTransfer({
        path: { id },
        body: { quoteId: q.id, refundAddress: account },
      });

      setBusy("Confirm the transfer in your wallet…");
      const txHash = await sendToken(
        wallet,
        account,
        chain,
        token.address,
        transfer.paymentInstructions.address,
        transfer.paymentInstructions.amount,
      );

      setStep({ kind: "tracking", transferId: transfer.id, txHash });
    });

  const payManually = (q: Quote) =>
    run(async () => {
      setBusy("Preparing payment details…");
      const { data: transfer } = await postApiCheckoutByIdTransfer({
        path: { id },
        body: { quoteId: q.id, refundAddress: refundAddress.trim() },
      });

      setStep({ kind: "instructions", transfer });
    });

  const instructionStatus = useQuery({
    ...getApiCheckoutByIdTransferByTransferIdOptions({
      path: {
        id,
        transferId: step.kind === "instructions" ? step.transfer.id : "",
      },
    }),
    enabled: step.kind === "instructions",
    refetchInterval: 4000,
  });

  // Hand over to the status view once the deposit is seen, or once the
  // window to pay has closed.
  const windowClosed =
    step.kind === "instructions" &&
    new Date(step.transfer.paymentInstructions.expiresAt).getTime() <= now;
  useEffect(() => {
    const status = instructionStatus.data?.status;
    if (
      step.kind === "instructions" &&
      ((status && !Pending.includes(status)) || windowClosed)
    ) {
      setStep({ kind: "tracking", transferId: step.transfer.id });
    }
  }, [instructionStatus.data?.status, step, windowClosed]);

  const tokenOptions = useMemo(
    () =>
      chain?.tokens.map((t) => ({
        value: t.address,
        label:
          method === "wallet" && t.x402 ? `${t.symbol} · no gas fee` : t.symbol,
      })) ?? [],
    [chain, method],
  );

  const back = (to: Step) => (
    <button
      type="button"
      className="mb-4 inline-flex items-center gap-1 text-sm text-muted hover:text-ink"
      onClick={() => {
        setError(null);
        setStep(to);
      }}
    >
      <IconArrowLeft className="size-4" /> Back
    </button>
  );

  let body: ReactNode;

  if (checkout.isLoading) {
    body = (
      <div className="flex justify-center py-16">
        <IconLoader2 className="size-6 animate-spin text-muted" />
      </div>
    );
  } else if (!checkout.data) {
    body = (
      <div className="space-y-2 py-12 text-center">
        <IconCircleX className="mx-auto size-10 text-muted" />
        <h1 className="text-lg font-semibold">Payment link not found</h1>
        <p className="text-sm text-muted">
          It may have been removed. Check the link with whoever sent it.
        </p>
      </div>
    );
  } else if (step.kind === "details") {
    body = (
      <div className="space-y-6">
        <Summary checkout={checkout.data} />
        {chains.length ? (
          <Button
            className="h-12 w-full text-base"
            onClick={() => setStep({ kind: "method" })}
          >
            Pay
          </Button>
        ) : (
          <ErrorNote>This link can't be paid right now.</ErrorNote>
        )}
      </div>
    );
  } else if (step.kind === "method") {
    body = (
      <div className="space-y-3">
        {back({ kind: "details" })}
        <h2 className="text-lg font-semibold">How would you like to pay?</h2>

        {wallets === null ? (
          <Choice
            icon={<IconWallet className="size-5" />}
            title="Connect a wallet"
            description="Pay from a browser wallet; gasless where the token allows."
            onClick={chooseWallet}
            disabled={!!busy}
          />
        ) : wallets.length ? (
          wallets.map((w) => (
            <Choice
              key={w.id}
              icon={
                w.icon ? (
                  <img src={w.icon} alt="" className="size-6" />
                ) : (
                  <IconWallet className="size-5" />
                )
              }
              title={w.name}
              description="Connect and pay"
              onClick={() => connect(w)}
              disabled={!!busy}
            />
          ))
        ) : (
          <p className="rounded-xl bg-soft p-3 text-sm text-muted">
            No browser wallet found. You can still pay by sending tokens to an
            address.
          </p>
        )}

        <Choice
          icon={<IconFileText className="size-5" />}
          title="Pay with payment details"
          description="Get an address and amount to send from any wallet or exchange."
          onClick={() => {
            setError(null);
            setStep({ kind: "pay", method: "manual" });
          }}
          disabled={!!busy}
        />
      </div>
    );
  } else if (step.kind === "pay") {
    const q = quote.data;
    const wantsRefund = step.method === "manual";
    const refundValid = isAddress(refundAddress.trim());

    body = (
      <div className="space-y-4">
        {back({ kind: "method" })}
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-lg font-semibold">
            {formatMoney(
              checkout.data.paymentLink.amount,
              checkout.data.paymentLink.currency,
            )}
          </h2>
          {account && (
            <span className="rounded-full bg-soft px-2.5 py-1 font-mono text-xs">
              {shortAddress(account)}
            </span>
          )}
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Network">
            <Select
              value={chainId}
              onChange={(e) => {
                setChainId(e.target.value);
                setTokenAddress("");
              }}
            >
              {chains.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Pay with">
            <Select
              value={tokenAddress}
              onChange={(e) => setTokenAddress(e.target.value)}
            >
              {tokenOptions.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <div className="rounded-xl border border-line px-4">
          <Row label="You pay">
            {quote.isFetching ? (
              <IconLoader2 className="ml-auto size-4 animate-spin text-muted" />
            ) : q && token ? (
              <span className="font-medium">
                {formatUnits(BigInt(q.sourceAmount), token.decimals)}{" "}
                {token.symbol}
              </span>
            ) : (
              "—"
            )}
          </Row>
          {q && !quote.isFetching && (
            <Row label="Price valid for">
              {quoteExpired ? (
                <button
                  type="button"
                  className="text-brand hover:underline"
                  onClick={() => quote.refetch()}
                >
                  Refresh price
                </button>
              ) : (
                <Countdown until={q.expiresAt} />
              )}
            </Row>
          )}
          {step.method === "wallet" && token && (
            <Row label="Network fee">
              {token.x402 ? (
                <span className="inline-flex items-center gap-1 text-success">
                  <IconBolt className="size-3.5" /> None, just sign
                </span>
              ) : (
                `Paid in ${chain?.nativeCurrency.symbol ?? "gas"}`
              )}
            </Row>
          )}
        </div>

        {quote.error && <ErrorNote>{quote.error.message}</ErrorNote>}

        {wantsRefund && (
          <Field
            label="Refund address"
            hint="Where to return funds if the payment can't be completed."
          >
            <Input
              placeholder="0x…"
              value={refundAddress}
              onChange={(e) => setRefundAddress(e.target.value)}
              className="font-mono"
            />
          </Field>
        )}

        {error && <ErrorNote>{error}</ErrorNote>}

        <Button
          className="h-12 w-full text-base"
          disabled={
            !q ||
            quote.isFetching ||
            quoteExpired ||
            !!busy ||
            (wantsRefund && !refundValid)
          }
          onClick={() =>
            q && (step.method === "wallet" ? payWithWallet(q) : payManually(q))
          }
        >
          {busy ? (
            <>
              <IconLoader2 className="size-4 animate-spin" />
              {busy}
            </>
          ) : step.method === "wallet" ? (
            token?.x402 ? (
              "Sign and pay"
            ) : (
              "Pay"
            )
          ) : (
            "Get payment details"
          )}
        </Button>
      </div>
    );
  } else if (step.kind === "instructions") {
    body =
      chain && token ? (
        <Instructions transfer={step.transfer} chain={chain} token={token} />
      ) : null;
  } else {
    body = (
      <Status
        checkout={checkout.data}
        chain={chain}
        transferId={step.transferId}
        txHash={step.txHash}
        onRestart={restart}
      />
    );
  }

  const app = checkout.data?.app;

  return (
    <div className="flex min-h-full flex-col items-center px-4 py-8 sm:py-16">
      <Card className="w-full max-w-md p-6 shadow-sm">
        {body}
        {busy && step.kind === "method" && (
          <p className="mt-3 flex items-center gap-2 text-sm text-muted">
            <IconLoader2 className="size-4 animate-spin" />
            {busy}
          </p>
        )}
        {error && step.kind === "method" && (
          <div className="mt-3">
            <ErrorNote>{error}</ErrorNote>
          </div>
        )}
      </Card>

      <footer className="mt-6 flex flex-wrap items-center justify-center gap-x-4 gap-y-2 text-xs text-muted">
        <span className="flex items-center gap-1.5">
          Powered by <Logo className="text-sm [&_img]:size-4" />
        </span>
        {app?.termsOfServiceUrl && (
          <a href={app.termsOfServiceUrl} target="_blank" rel="noreferrer">
            Terms
          </a>
        )}
        {app?.privacyPolicyUrl && (
          <a href={app.privacyPolicyUrl} target="_blank" rel="noreferrer">
            Privacy
          </a>
        )}
      </footer>
    </div>
  );
};
