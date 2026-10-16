import {
  IconArrowBackUp,
  IconArrowsExchange,
  IconCoins,
  IconExternalLink,
  IconPlus,
} from "@tabler/icons-react";
import { useState, type FormEvent } from "react";
import {
  getApiTransfersOptions,
  postApiTransfersByIdRecoverBalanceMutation,
  postApiTransfersByIdRecoverMutation,
  postApiTransfersByIdRefundMutation,
  postApiTransfersMutation,
} from "@/api/@tanstack/react-query.gen";
import type { TransferListItem } from "@/api/types.gen";
import { CopyButton } from "@/components/copy-button";
import { DataTable } from "@/components/data-table";
import { Field } from "@/components/field";
import { PageHeader } from "@/components/page-header";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input, Select } from "@/components/ui/input";
import {
  formatDateTime,
  formatTokenAmount,
  formatUsd,
  shortAddress,
  shortId,
} from "@/lib/format";
import { useAppHeaders, useMutate } from "@/lib/queries";
import { useSupportedChains } from "./chains";
import None from "@/components/none";

type Status = TransferListItem["status"];

const statuses: Status[] = [
  "AwaitingDeposit",
  "DepositReceived",
  "Processing",
  "x402Settled",
  "Settled",
  "Refunded",
  "Failed",
  "Cancelled",
];

export const NewTransferDialog = ({
  quoteId,
  onClose,
  onCreated,
}: {
  quoteId: string | null;
  onClose: () => void;
  onCreated: () => void;
}) => {
  const [quote, setQuote] = useState("");
  const [refundAddress, setRefundAddress] = useState("");

  const headers = useAppHeaders();
  const create = useMutate(postApiTransfersMutation({ headers }), {
    success: "Transfer opened",
    onSuccess: onCreated,
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    create.mutate({
      body: {
        quoteId: (quoteId ?? quote).trim(),
        refundAddress: refundAddress.trim(),
      },
    });
  };

  return (
    <Dialog
      open={quoteId !== null}
      onOpenChange={(open) => !open && onClose()}
      title="Open transfer"
    >
      <form className="space-y-4" onSubmit={submit}>
        <Field label="Quote ID">
          <Input
            required
            readOnly={!!quoteId}
            value={quoteId || quote}
            onChange={(event) => setQuote(event.target.value)}
          />
        </Field>
        <Field
          label="Refund address"
          hint="Where funds go if the payment cannot be completed."
        >
          <Input
            required
            value={refundAddress}
            onChange={(event) => setRefundAddress(event.target.value)}
          />
        </Field>
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="submit"
            disabled={create.isPending || !refundAddress.trim()}
          >
            Open transfer
          </Button>
        </div>
      </form>
    </Dialog>
  );
};

const Hash = ({ value, explorer }: { value: string; explorer?: string }) => (
  <span className="flex items-center gap-1 font-mono">
    {shortAddress(value)}
    <CopyButton className="size-max text-muted" value={value} />
    {explorer && (
      <a
        href={`${explorer}/tx/${value}`}
        target="_blank"
        rel="noreferrer"
        aria-label="Open in explorer"
        className="text-muted"
      >
        <IconExternalLink className="size-4" />
      </a>
    )}
  </span>
);

const Detail = ({
  transfer,
  explorer,
  onRefund,
  onRecover,
}: {
  transfer: TransferListItem;
  explorer?: string;
  onRefund: () => void;
  onRecover: () => void;
}) => {
  const { quote } = transfer;
  const canRefund =
    !["Settled", "Refunded"].includes(transfer.status) &&
    !(transfer.status === "Failed" && transfer.x402SettledAt);
  const canRecover = !(transfer.status === "Failed" && transfer.x402SettledAt);

  // Label/value pairs, keyed by label where they're rendered.
  /* oxlint-disable react/jsx-key */
  const rows: [string, React.ReactNode][] = [
    ["Status", <StatusBadge status={transfer.status} />],
    [
      "Customer pays",
      `${formatTokenAmount(quote.sourceAmount, quote.sourceToken.decimals)} ${quote.sourceToken.symbol}`,
    ],
    ["Value", formatUsd(quote.targetUsdAmount)],
    [
      "Customer",
      quote.customer?.name ?? quote.customer?.externalId ?? <None />,
    ],
    ["Reference", quote.reference ?? <None />],
    ["Payin address", <Hash value={transfer.payinAddress} />],
    ["Refund address", <Hash value={transfer.refundAddress} />],
    ["Settles to", <Hash value={transfer.settlementRecipient} />],
    ...(transfer.settlementBlockchainHash
      ? ([
          [
            "Settlement transaction",
            <Hash
              value={transfer.settlementBlockchainHash}
              explorer={explorer}
            />,
          ],
        ] as [string, React.ReactNode][])
      : []),
    ...(transfer.refundBlockchainHash
      ? ([
          [
            "Refund transaction",
            <Hash value={transfer.refundBlockchainHash} explorer={explorer} />,
          ],
        ] as [string, React.ReactNode][])
      : []),
    ...(transfer.x402BlockchainHash
      ? ([
          [
            "x402 transaction",
            <Hash value={transfer.x402BlockchainHash} explorer={explorer} />,
          ],
        ] as [string, React.ReactNode][])
      : []),
    ["Created", formatDateTime(transfer.createdAt)],
    ["Quote expires", formatDateTime(quote.expiresAt)],
  ];
  /* oxlint-enable react/jsx-key */

  return (
    <div className="space-y-7">
      <dl className="space-y-3.5 text-sm">
        {rows.map(([label, value]) => (
          <div key={label} className="flex items-center justify-between gap-4">
            <dt className="text-muted">{label}</dt>
            <dd className="text-right">{value}</dd>
          </div>
        ))}
      </dl>

      <div>
        <p className="mb-3 text-base font-medium font-display">Timeline</p>
        <ol className="space-y-4.5 border-l border-line pl-4 ml-1">
          {[...transfer.timeline]
            .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
            .map((entry) => (
              <li key={entry.id} className="relative text-sm space-y-1">
                <span className="absolute -left-5.25 top-1.5 size-2 rounded-full bg-ink" />
                <p>{entry.description}</p>
                <p className="text-xs text-muted">
                  {formatDateTime(entry.createdAt)}
                </p>
              </li>
            ))}
        </ol>
      </div>

      {(canRefund || canRecover) && (
        <div className="flex justify-end gap-2 border-t border-line pt-4">
          {canRecover && (
            <Button variant="secondary" onClick={onRecover}>
              <IconCoins className="size-4" />
              Recover
            </Button>
          )}
          {canRefund && (
            <Button variant="danger" onClick={onRefund}>
              <IconArrowBackUp className="size-4" />
              Refund
            </Button>
          )}
        </div>
      )}
    </div>
  );
};

export const Transfers = () => {
  const headers = useAppHeaders();
  const [status, setStatus] = useState<Status | "">("");
  const [selected, setSelected] = useState<TransferListItem | null>(null);
  const [action, setAction] = useState<"refund" | "recover" | null>(null);
  const [tokenAddress, setTokenAddress] = useState("");
  const [destinationAddress, setDestinationAddress] = useState("");
  const [recoveryBalance, setRecoveryBalance] = useState<string | null>(null);
  const [useGasSponsor, setUseGasSponsor] = useState(true);
  const [opening, setOpening] = useState(false);
  const refund = useMutate(postApiTransfersByIdRefundMutation({ headers }), {
    success: "Transfer refunded",
    onSuccess: () => {
      setAction(null);
      setSelected(null);
    },
  });
  const checkBalance = useMutate(
    postApiTransfersByIdRecoverBalanceMutation({ headers }),
    { onSuccess: (result) => setRecoveryBalance(result.balance) },
  );
  const recover = useMutate(postApiTransfersByIdRecoverMutation({ headers }), {
    success: "Token recovery submitted",
    onSuccess: () => {
      setAction(null);
      setSelected(null);
    },
  });
  const supported = useSupportedChains();
  const explorer = supported.data?.find(
    (chain) => chain.caip2Id === selected?.quote.chain.caip2Id,
  )?.blockExplorer.url;
  const recoveryToken = selected
    ? [selected.quote.sourceToken, selected.quote.targetToken].find(
        (token) => token.address.toLowerCase() === tokenAddress.toLowerCase(),
      )
    : undefined;

  return (
    <>
      <PageHeader title="Transfers" />

      <DataTable
        exportName="transfers"
        options={(query) =>
          getApiTransfersOptions({
            query: { ...query, status: status || undefined },
            headers,
          })
        }
        rowKey={(row) => row.id}
        searchPlaceholder="Search by ID, address, reference or customer"
        empty={{
          icon: IconArrowsExchange,
          title: "No transfers yet",
          description: "A transfer opens when a customer pays a quote.",
        }}
        onRowClick={(row) => setSelected(row)}
        toolbar={
          <>
            <Select
              wrapperClassName="w-40"
              value={status}
              onChange={(event) => setStatus(event.target.value as Status | "")}
              aria-label="Status"
            >
              <option value="">All statuses</option>
              {statuses.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </Select>
            <Button onClick={() => setOpening(true)}>
              <IconPlus className="size-4" />
              Open transfer
            </Button>
          </>
        }
        columns={[
          {
            header: "ID",
            exportValue: (row) => row.id,
            cell: (row) => <p>#{shortId(row.id)}...</p>,
          },
          {
            header: "Status",
            exportValue: (row) => row.status,
            cell: (row) => <StatusBadge status={row.status} />,
          },
          {
            header: "Customer pays",
            cell: (row) =>
              `${formatTokenAmount(row.quote.sourceAmount, row.quote.sourceToken.decimals)} ${row.quote.sourceToken.symbol}`,
          },
          {
            header: "Value",
            cell: (row) => formatUsd(row.quote.targetUsdAmount),
          },
          { header: "Created", cell: (row) => formatDateTime(row.createdAt) },
        ]}
      />

      <Dialog
        open={selected !== null && action === null}
        onOpenChange={(open) => !open && action === null && setSelected(null)}
        title={selected ? `Transfer #${shortId(selected.id)}` : "Transfer"}
        className="max-w-xl"
      >
        {selected && (
          <Detail
            transfer={selected}
            explorer={explorer}
            onRefund={() => {
              setUseGasSponsor(true);
              setAction("refund");
            }}
            onRecover={() => {
              setTokenAddress("");
              setDestinationAddress("");
              setRecoveryBalance(null);
              setUseGasSponsor(true);
              setAction("recover");
            }}
          />
        )}
      </Dialog>

      <Dialog
        open={action === "refund"}
        onOpenChange={(open) => !open && setAction(null)}
        title="Refund transfer"
        description="Send the pay-in funds to the transfer's refund address."
        className="max-w-md"
      >
        {selected && (
          <div className="space-y-5">
            {selected.quote.chain.isActive && (
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={useGasSponsor}
                  onChange={(event) => setUseGasSponsor(event.target.checked)}
                />
                Use gas sponsor
              </label>
            )}
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setAction(null)}>
                Cancel
              </Button>
              <Button
                variant="danger"
                disabled={refund.isPending}
                onClick={() =>
                  refund.mutate({
                    path: { id: selected.id },
                    body: {
                      useGasSponsor:
                        !selected.quote.chain.isActive || useGasSponsor,
                    },
                  })
                }
              >
                Refund
              </Button>
            </div>
          </div>
        )}
      </Dialog>

      <Dialog
        open={action === "recover"}
        onOpenChange={(open) => !open && setAction(null)}
        title="Recover token"
        description="Check the pay-in address before choosing where to send the token."
        className="max-w-md"
      >
        {selected && (
          <div className="space-y-4">
            <Field label="Token address">
              <Input
                required
                value={tokenAddress}
                onChange={(event) => {
                  setTokenAddress(event.target.value);
                  setRecoveryBalance(null);
                }}
              />
            </Field>
            <Button
              variant="secondary"
              disabled={!tokenAddress.trim() || checkBalance.isPending}
              onClick={() =>
                checkBalance.mutate({
                  path: { id: selected.id },
                  body: { tokenAddress: tokenAddress.trim() },
                })
              }
            >
              Check balance
            </Button>
            {recoveryBalance !== null && (
              <p className="text-sm text-muted">
                Pay-in balance:{" "}
                {recoveryToken
                  ? `${formatTokenAmount(recoveryBalance, recoveryToken.decimals)} ${recoveryToken.symbol}`
                  : recoveryBalance}
              </p>
            )}
            {recoveryBalance !== null && BigInt(recoveryBalance) > 0n && (
              <>
                <Field label="Destination address">
                  <Input
                    required
                    value={destinationAddress}
                    onChange={(event) =>
                      setDestinationAddress(event.target.value)
                    }
                  />
                </Field>
                {selected.quote.chain.isActive && (
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={useGasSponsor}
                      onChange={(event) =>
                        setUseGasSponsor(event.target.checked)
                      }
                    />
                    Use gas sponsor
                  </label>
                )}
                <div className="flex justify-end gap-2 pt-1">
                  <Button variant="secondary" onClick={() => setAction(null)}>
                    Cancel
                  </Button>
                  <Button
                    disabled={!destinationAddress.trim() || recover.isPending}
                    onClick={() =>
                      recover.mutate({
                        path: { id: selected.id },
                        body: {
                          tokenAddress: tokenAddress.trim(),
                          destinationAddress: destinationAddress.trim(),
                          useGasSponsor:
                            !selected.quote.chain.isActive || useGasSponsor,
                        },
                      })
                    }
                  >
                    Recover
                  </Button>
                </div>
              </>
            )}
            {(recoveryBalance === null || BigInt(recoveryBalance) === 0n) && (
              <div className="flex justify-end pt-1">
                <Button variant="secondary" onClick={() => setAction(null)}>
                  Close
                </Button>
              </div>
            )}
          </div>
        )}
      </Dialog>

      <NewTransferDialog
        quoteId={opening ? "" : null}
        onClose={() => setOpening(false)}
        onCreated={() => setOpening(false)}
      />
    </>
  );
};
