import { useQuery } from "@tanstack/react-query";
import {
  IconExternalLink,
  IconPaywall,
  IconPencil,
  IconPlus,
  IconTrash,
} from "@tabler/icons-react";
import { useState, type FormEvent } from "react";
import { formatUnits, parseUnits } from "viem";
import {
  paymentLinksDeleteMutation,
  paymentLinksListCurrenciesOptions,
  paymentLinksListOptions,
  paymentLinksUpdateMutation,
  paymentLinksCreateMutation,
} from "@/api/@tanstack/react-query.gen";
import type { PaymentLink } from "@/api/types.gen";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { CopyButton } from "@/components/copy-button";
import { DataTable } from "@/components/data-table";
import { Field } from "@/components/field";
import {
  fromLineItemRows,
  LineItemsBuilder,
  lineItemsTotal,
  toLineItemRows,
} from "@/components/line-items-builder";
import { PageHeader } from "@/components/page-header";
import { RowActions } from "@/components/row-actions";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input, Select } from "@/components/ui/input";
import { formatDate } from "@/lib/format";
import { useAppHeaders, useMutate } from "@/lib/queries";

const trimAmount = (value: string) =>
  value.includes(".") ? value.replace(/0+$/, "").replace(/\.$/, "") : value;

const payUrl = (id: string) => `${window.location.origin}/pay/${id}`;

const LinkForm = ({
  link,
  onClose,
}: {
  link?: PaymentLink;
  onClose: () => void;
}) => {
  const [values, setValues] = useState({
    title: link?.title ?? "",
    currency: link?.currency ?? "USD",
    amount: link ? trimAmount(link.amount) : "",
    returnUrl: link?.returnUrl ?? "",
    usage: link?.usage ?? "Reusable",
  });
  const [lineItems, setLineItems] = useState(() =>
    toLineItemRows(link?.lineItems ?? null),
  );
  const [lineItemsError, setLineItemsError] = useState<string | null>(null);

  const headers = useAppHeaders();
  const currencies = useQuery(paymentLinksListCurrenciesOptions({ headers }));
  // Keep a link's existing currency selectable even if its feed was removed.
  const currencyOptions = [
    ...new Set([...(currencies.data?.data ?? ["USD"]), values.currency]),
  ];

  const create = useMutate(paymentLinksCreateMutation({ headers }), {
    success: "Payment link created",
    onSuccess: onClose,
  });

  const update = useMutate(paymentLinksUpdateMutation({ headers }), {
    success: "Payment link updated",
    onSuccess: onClose,
  });

  const set =
    (key: keyof typeof values) => (event: { target: { value: string } }) =>
      setValues({ ...values, [key]: event.target.value });

  const submit = (event: FormEvent) => {
    event.preventDefault();

    const items = fromLineItemRows(lineItems);
    if (items.length) {
      const total = lineItemsTotal(items);
      let amount: bigint | null = null;
      try {
        amount = parseUnits(values.amount.trim(), 36);
      } catch {
        // An amount that isn't a number is reported by the API.
      }

      if (amount !== null && total !== amount) {
        return setLineItemsError(
          `Line items add up to ${formatUnits(total, 36)} ${values.currency}, but the amount is ${formatUnits(amount, 36)} ${values.currency}.`,
        );
      }
    }
    setLineItemsError(null);

    const body = {
      title: values.title.trim(),
      currency: values.currency.trim(),
      amount: values.amount.trim(),
      // An edit sends an empty list to remove the link's line items.
      lineItems: items.length || link ? items : undefined,
      usage: values.usage,
      // ...and null to remove its return URL.
      returnUrl: values.returnUrl.trim() || (link ? null : undefined),
    };

    if (link) update.mutate({ path: { id: link.id }, body });
    else create.mutate({ body });
  };

  return (
    <form className="space-y-4" onSubmit={submit}>
      <Field label="Title">
        <Input required value={values.title} onChange={set("title")} />
      </Field>
      <div className="grid grid-cols-[1fr_120px] gap-3">
        <Field label="Amount">
          <Input
            required
            inputMode="decimal"
            value={values.amount}
            onChange={set("amount")}
          />
        </Field>
        <Field label="Currency">
          <Select
            required
            value={values.currency}
            onChange={set("currency")}
            disabled={currencies.isLoading}
          >
            {currencyOptions.map((currency) => (
              <option key={currency} value={currency}>
                {currency}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      <Field
        label="Line items"
        hint="Optional. Shown to customers at checkout."
      >
        <LineItemsBuilder
          rows={lineItems}
          currency={values.currency}
          onChange={setLineItems}
        />
        {lineItemsError && (
          <p className="text-xs text-danger">{lineItemsError}</p>
        )}
      </Field>
      <Field
        label="Usage"
        hint="A reusable link can accept more than one payment meanwhile a one time link can't be used after a transfer has used it"
      >
        <Select value={values.usage} onChange={set("usage")}>
          {["OneTime", "Reusable"]?.map((item) => (
            <option key={item} value={item}>
              {item}
            </option>
          ))}
        </Select>
      </Field>

      <Field
        label="Return URL (optional)"
        hint="Where customers go once a payment completes, fails or is cancelled, with status and transferId added"
      >
        <Input
          type="url"
          placeholder="https://"
          value={values.returnUrl}
          onChange={set("returnUrl")}
        />
      </Field>
      <div className="flex justify-end gap-2 pt-2">
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" disabled={create.isPending || update.isPending}>
          {link ? "Save" : "Create link"}
        </Button>
      </div>
    </form>
  );
};

export const PaymentLinks = () => {
  const [editing, setEditing] = useState<PaymentLink | "new" | null>(null);
  const [deleting, setDeleting] = useState<PaymentLink | null>(null);
  const headers = useAppHeaders();

  const remove = useMutate(paymentLinksDeleteMutation({ headers }), {
    success: "Payment link deleted",
    onSuccess: () => setDeleting(null),
  });

  return (
    <>
      <PageHeader title="Payment links" />

      <DataTable
        exportName="payment-links"
        options={(query) => paymentLinksListOptions({ query, headers })}
        rowKey={(row) => row.id}
        searchPlaceholder="Search payment links"
        empty={{
          icon: IconPaywall,
          title: "No payment links yet",
          description:
            "Create a reusable link customers can pay with any supported token.",
        }}
        toolbar={
          <Button onClick={() => setEditing("new")}>
            <IconPlus className="size-4" />
            New payment link
          </Button>
        }
        columns={[
          {
            header: "Title",
            exportValue: (row) => row.title,
            cell: (row) => <span className="font-medium">{row.title}</span>,
          },
          {
            header: "Amount",
            cell: (row) => `${trimAmount(row.amount)} ${row.currency}`,
          },
          {
            header: "Payment link",
            exportValue: (row) => payUrl(row.id),
            cell: (row) => (
              <span className="flex items-center gap-1">
                <CopyButton
                  variant="default"
                  value={payUrl(row.id)}
                  label="Copy"
                />
                <Button
                  variant="ghost"
                  size="iconSm"
                  aria-label="Open checkout"
                  onClick={() => window.open(payUrl(row.id), "_blank")}
                >
                  <IconExternalLink className="size-4" />
                </Button>
              </span>
            ),
          },
          { header: "Created", cell: (row) => formatDate(row.createdAt) },
          {
            header: "",
            className: "w-12 text-right",
            cell: (row) => (
              <RowActions
                actions={[
                  {
                    label: "Edit",
                    icon: <IconPencil className="size-4" />,
                    onSelect: () => setEditing(row),
                  },
                  {
                    label: "Delete",
                    icon: <IconTrash className="size-4" />,
                    danger: true,
                    onSelect: () => setDeleting(row),
                  },
                ]}
              />
            ),
          },
        ]}
      />

      <Dialog
        open={editing !== null}
        onOpenChange={(open) => !open && setEditing(null)}
        title={editing === "new" ? "New payment link" : "Edit payment link"}
      >
        {editing !== null && (
          <LinkForm
            link={editing === "new" ? undefined : editing}
            onClose={() => setEditing(null)}
          />
        )}
      </Dialog>

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title="Delete payment link"
        description={`${deleting?.title} can no longer be paid. Quotes already created from it are kept.`}
        confirmLabel="Delete payment link"
        pending={remove.isPending}
        onConfirm={() =>
          deleting && remove.mutate({ path: { id: deleting.id } })
        }
      />
    </>
  );
};
