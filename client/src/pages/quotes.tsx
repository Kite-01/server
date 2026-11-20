import { useQuery } from "@tanstack/react-query";
import {
  IconArrowsExchange,
  IconPlus,
  IconReceipt2,
} from "@tabler/icons-react";
import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import {
  chainsListOptions,
  quotesListOptions,
  quotesCreateMutation,
} from "@/api/@tanstack/react-query.gen";
import { tokensGetByAddress } from "@/api/sdk.gen";
import { CopyButton } from "@/components/copy-button";
import { DataTable } from "@/components/data-table";
import { Field } from "@/components/field";
import { PageHeader } from "@/components/page-header";
import { RowActions } from "@/components/row-actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input, Select } from "@/components/ui/input";
import {
  formatDateTime,
  formatTokenAmount,
  formatUsd,
  parseUnits,
  shortId,
} from "@/lib/format";
import { useAppHeaders, useAppScope, useMutate } from "@/lib/queries";
import { toast } from "sonner";
import { NewTransferDialog } from "./transfers";
import None from "@/components/none";

const NewQuoteForm = ({ onClose }: { onClose: () => void }) => {
  const headers = useAppHeaders();
  const chains = useQuery(chainsListOptions({ headers }));
  const [chainId, setChainId] = useState("");
  const [address, setAddress] = useState("");
  const [amount, setAmount] = useState("");
  const [reference, setReference] = useState("");
  const [pending, setPending] = useState(false);

  const create = useMutate(quotesCreateMutation({ headers }), {
    success: "Quote created",
    onSuccess: onClose,
  });

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const chain = chainId || chains.data?.data[0]?.id;
    if (!chain) return;

    setPending(true);
    try {
      const { data: token } = await tokensGetByAddress({
        path: { chainId: chain, address: address.trim() },
        headers,
      });

      create.mutate({
        body: {
          chainId: chain,
          sourceTokenAddress: token.address,
          amount: parseUnits(amount, token.decimals),
          ...(reference.trim() ? { reference: reference.trim() } : {}),
        },
      });
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not create the quote",
      );
    } finally {
      setPending(false);
    }
  };

  return (
    <form className="space-y-4" onSubmit={submit}>
      <Field label="Chain">
        <Select
          value={chainId}
          onChange={(event) => setChainId(event.target.value)}
        >
          {chains.data?.data.map((chain) => (
            <option key={chain.id} value={chain.id}>
              {chain.name}
            </option>
          ))}
        </Select>
      </Field>
      <Field
        label="Token the customer pays with"
        hint="Contract address. The zero address is the chain's native currency."
      >
        <Input
          required
          value={address}
          onChange={(event) => setAddress(event.target.value)}
        />
      </Field>
      <Field label="Amount" hint="In the token's own units, e.g. 25.50">
        <Input
          required
          inputMode="decimal"
          value={amount}
          onChange={(event) => setAmount(event.target.value)}
        />
      </Field>
      <Field label="Reference (optional)" hint="Unique per app.">
        <Input
          value={reference}
          onChange={(event) => setReference(event.target.value)}
        />
      </Field>
      <div className="flex justify-end gap-2 pt-2">
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button
          type="submit"
          disabled={
            pending || create.isPending || !address.trim() || !amount.trim()
          }
        >
          Create quote
        </Button>
      </div>
    </form>
  );
};

export const Quotes = () => {
  const navigate = useNavigate();
  const { appId } = useAppScope();
  const headers = useAppHeaders();
  const chains = useQuery(chainsListOptions({ headers }));
  const [creating, setCreating] = useState(false);
  const [transferFor, setTransferFor] = useState<string | null>(null);

  return (
    <>
      <PageHeader title="Quotes" />

      <DataTable
        exportName="quotes"
        options={(query) => quotesListOptions({ query, headers })}
        rowKey={(row) => row.id}
        searchPlaceholder="Search by reference or ID"
        empty={{
          icon: IconReceipt2,
          title: "No quotes yet",
          description: "Quotes created under this app will appear here.",
        }}
        toolbar={
          <Button
            disabled={!chains.data?.data.length}
            onClick={() => setCreating(true)}
          >
            <IconPlus className="size-4" />
            New quote
          </Button>
        }
        columns={[
          {
            header: "ID",
            exportValue: (row) => row.id,
            cell: (row) => (
              <p className="flex items-center">
                {shortId(row.id)}...
                <CopyButton value={row.id} />
              </p>
            ),
          },
          {
            header: "Reference",
            cell: (row) =>
              row.reference ? (
                <p className="flex items-center">
                  {row.reference}
                  <CopyButton value={row.reference} />
                </p>
              ) : (
                <None />
              ),
          },
          {
            header: "Customer",
            cell: (row) =>
              row.customer?.name ?? row.customer?.externalId ?? <None />,
          },
          {
            header: "Customer pays",
            cell: (row) =>
              `${formatTokenAmount(row.sourceAmount, row.sourceToken.decimals)} ${row.sourceToken.symbol}`,
          },
          { header: "Value", cell: (row) => formatUsd(row.targetUsdAmount) },
          { header: "Created", cell: (row) => formatDateTime(row.createdAt) },
          {
            header: "Status",
            cell: (row) =>
              new Date(row.expiresAt) < new Date() ? (
                <Badge variant="neutral">Expired</Badge>
              ) : (
                <Badge variant="success">Open</Badge>
              ),
          },
          {
            header: "",
            className: "w-12 text-right",
            cell: (row) => (
              <RowActions
                actions={[
                  {
                    label: "Open transfer",
                    icon: <IconArrowsExchange className="size-4" />,
                    hidden: new Date(row.expiresAt) < new Date(),
                    onSelect: () => setTransferFor(row.id),
                  },
                ]}
              />
            ),
          },
        ]}
      />

      <Dialog open={creating} onOpenChange={setCreating} title="New quote">
        <NewQuoteForm onClose={() => setCreating(false)} />
      </Dialog>

      <NewTransferDialog
        quoteId={transferFor}
        onClose={() => setTransferFor(null)}
        onCreated={() => {
          setTransferFor(null);
          navigate(`/apps/${appId}/transfers`);
        }}
      />
    </>
  );
};
