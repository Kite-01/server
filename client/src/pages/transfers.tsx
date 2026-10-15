import {
  IconArrowsExchange,
  IconExternalLink,
  IconPlus,
} from "@tabler/icons-react";
import { useState, type FormEvent } from "react";
import {
  getApiTransfersOptions,
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
      description="Opens the on-chain payment address for a quote."
    >
      <form className="space-y-4" onSubmit={submit}>
        <Field label="Quote ID">
          <Input
            required
            className="font-mono"
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
            className="font-mono"
            value={refundAddress}
            onChange={(event) => setRefundAddress(event.target.value)}
            placeholder="0x…"
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
  <span className="flex items-center gap-1 font-mono text-xs">
    {shortAddress(value)}
    <CopyButton value={value} />
    {explorer && (
      <a
        href={`${explorer}/tx/${value}`}
        target="_blank"
        rel="noreferrer"
        aria-label="Open in explorer"
        className="inline-flex size-8 items-center justify-center rounded-full hover:bg-soft"
      >
        <IconExternalLink className="size-4" />
      </a>
    )}
  </span>
);

const Detail = ({
  transfer,
  explorer,
}: {
  transfer: TransferListItem;
  explorer?: string;
}) => {
  const { quote } = transfer;

  // Label/value pairs, keyed by label where they're rendered.
  /* oxlint-disable react/jsx-key */
  const rows: [string, React.ReactNode][] = [
    ["Status", <StatusBadge status={transfer.status} />],
    [
      "Customer pays",
      `${formatTokenAmount(quote.sourceAmount, quote.sourceToken.decimals)} ${quote.sourceToken.symbol}`,
    ],
    ["Value", formatUsd(quote.targetUsdAmount)],
    ["Customer", quote.customer?.name ?? quote.customer?.externalId ?? "—"],
    ["Reference", quote.reference ?? "—"],
    ["Pay-in address", <Hash value={transfer.payinAddress} />],
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
    <div className="space-y-5">
      <dl className="space-y-2.5 text-sm">
        {rows.map(([label, value]) => (
          <div key={label} className="flex items-center justify-between gap-4">
            <dt className="text-muted">{label}</dt>
            <dd className="text-right">{value}</dd>
          </div>
        ))}
      </dl>

      <div>
        <p className="mb-2 text-xs font-medium text-muted">Timeline</p>
        <ol className="space-y-3 border-l border-line pl-4">
          {[...transfer.timeline]
            .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
            .map((entry) => (
              <li key={entry.id} className="relative text-sm">
                <span className="absolute -left-[21px] top-1.5 size-2 rounded-full bg-ink" />
                <p>{entry.description}</p>
                <p className="text-xs text-muted">
                  {formatDateTime(entry.createdAt)}
                </p>
              </li>
            ))}
        </ol>
      </div>
    </div>
  );
};

export const Transfers = () => {
  const headers = useAppHeaders();
  const [status, setStatus] = useState<Status | "">("");
  const [selected, setSelected] = useState<TransferListItem | null>(null);
  const [opening, setOpening] = useState(false);
  const supported = useSupportedChains();
  const explorer = supported.data?.find(
    (chain) => chain.caip2Id === selected?.quote.chain.caip2Id,
  )?.blockExplorer.url;

  return (
    <>
      <PageHeader
        title="Transfers"
        description="Payments made against quotes."
      />

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
            header: "Transfer",
            exportValue: (row) => row.id,
            cell: (row) => (
              <div>
                <p className="font-mono text-xs">#{shortId(row.id)}</p>
                <p className="text-xs text-muted">
                  {row.quote.customer?.name ??
                    row.quote.customer?.externalId ??
                    "No customer"}
                </p>
              </div>
            ),
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
        open={selected !== null}
        onOpenChange={(open) => !open && setSelected(null)}
        title={selected ? `Transfer #${shortId(selected.id)}` : "Transfer"}
        className="max-w-xl"
      >
        {selected && <Detail transfer={selected} explorer={explorer} />}
      </Dialog>

      <NewTransferDialog
        quoteId={opening ? "" : null}
        onClose={() => setOpening(false)}
        onCreated={() => setOpening(false)}
      />
    </>
  );
};
