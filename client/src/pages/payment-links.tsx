import { Pencil, Plus, Trash2 } from "lucide-react";
import { useState, type FormEvent } from "react";
import {
  deleteApiPaymentLinksByIdMutation,
  getApiPaymentLinksOptions,
  patchApiPaymentLinksByIdMutation,
  postApiPaymentLinksMutation,
} from "@/api/@tanstack/react-query.gen";
import type { PaymentLink, PostApiPaymentLinksData } from "@/api/types.gen";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { CopyButton } from "@/components/copy-button";
import { DataTable } from "@/components/data-table";
import { Field } from "@/components/field";
import { PageHeader } from "@/components/page-header";
import { RowActions } from "@/components/row-actions";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input, Textarea } from "@/components/ui/input";
import { formatDate, shortId } from "@/lib/format";
import { useAppHeaders, useMutate } from "@/lib/queries";

type LineItems = PostApiPaymentLinksData["body"]["lineItems"];

const trimAmount = (value: string) =>
  value.includes(".") ? value.replace(/0+$/, "").replace(/\.$/, "") : value;

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
    lineItems: link?.lineItems ? JSON.stringify(link.lineItems, null, 2) : "",
  });
  const [lineItemsError, setLineItemsError] = useState<string | null>(null);

  const headers = useAppHeaders();
  const create = useMutate(postApiPaymentLinksMutation({ headers }), {
    success: "Payment link created",
    onSuccess: onClose,
  });

  const update = useMutate(patchApiPaymentLinksByIdMutation({ headers }), {
    success: "Payment link updated",
    onSuccess: onClose,
  });

  const set =
    (key: keyof typeof values) => (event: { target: { value: string } }) =>
      setValues({ ...values, [key]: event.target.value });

  const submit = (event: FormEvent) => {
    event.preventDefault();

    let lineItems: LineItems;
    if (values.lineItems.trim()) {
      try {
        lineItems = JSON.parse(values.lineItems);
      } catch {
        return setLineItemsError("Line items must be valid JSON");
      }
    }

    setLineItemsError(null);
    const body = {
      title: values.title.trim(),
      currency: values.currency.trim(),
      amount: values.amount.trim(),
      lineItems,
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
          <Input required value={values.currency} onChange={set("currency")} />
        </Field>
      </div>
      <Field label="Line items" hint="Optional JSON.">
        <Textarea value={values.lineItems} onChange={set("lineItems")} />
        {lineItemsError && (
          <p className="text-xs text-danger">{lineItemsError}</p>
        )}
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

  const remove = useMutate(deleteApiPaymentLinksByIdMutation({ headers }), {
    success: "Payment link deleted",
    onSuccess: () => setDeleting(null),
  });

  return (
    <>
      <PageHeader
        title="Payment links"
        description="Reusable payment requests."
      />

      <DataTable
        options={(query) => getApiPaymentLinksOptions({ query, headers })}
        rowKey={(row) => row.id}
        searchPlaceholder="Search payment links"
        empty="No payment links yet"
        toolbar={
          <Button onClick={() => setEditing("new")}>
            <Plus className="size-4" />
            New payment link
          </Button>
        }
        columns={[
          {
            header: "Title",
            cell: (row) => <span className="font-medium">{row.title}</span>,
          },
          {
            header: "Amount",
            cell: (row) => `${trimAmount(row.amount)} ${row.currency}`,
          },
          {
            header: "ID",
            cell: (row) => (
              <span className="flex items-center gap-1 font-mono text-xs">
                {shortId(row.id)}
                <CopyButton value={row.id} />
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
                    icon: <Pencil className="size-4" />,
                    onSelect: () => setEditing(row),
                  },
                  {
                    label: "Delete",
                    icon: <Trash2 className="size-4" />,
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
