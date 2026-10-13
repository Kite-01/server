import { Pencil, Plus, Trash2 } from "lucide-react";
import { useState, type FormEvent } from "react";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { CopyButton } from "@/components/copy-button";
import { DataTable } from "@/components/data-table";
import { Field } from "@/components/field";
import { PageHeader } from "@/components/page-header";
import { RowActions } from "@/components/row-actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input, Select, Textarea } from "@/components/ui/input";
import { formatDate, shortId } from "@/lib/format";
import { useMutate } from "@/lib/queries";

type PaymentLink = {
  id: string;
  title: string;
  currency: string;
  mode: "Api" | "Ui";
  amount: string;
  lineItems: unknown;
  createdAt: string;
};

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
    mode: link?.mode ?? "Ui",
    amount: link ? trimAmount(link.amount) : "",
    lineItems: link?.lineItems ? JSON.stringify(link.lineItems, null, 2) : "",
  });
  const [lineItemsError, setLineItemsError] = useState<string | null>(null);

  const save = useMutate<Record<string, unknown>>(
    link ? "PATCH" : "POST",
    link ? `/api/payment-links/${link.id}` : "/api/payment-links",
    {
      success: link ? "Payment link updated" : "Payment link created",
      onSuccess: onClose,
    },
  );

  const set =
    (key: keyof typeof values) => (event: { target: { value: string } }) =>
      setValues({ ...values, [key]: event.target.value });

  const submit = (event: FormEvent) => {
    event.preventDefault();

    let lineItems: unknown = null;
    if (values.lineItems.trim()) {
      try {
        lineItems = JSON.parse(values.lineItems);
      } catch {
        return setLineItemsError("Line items must be valid JSON");
      }
    }

    setLineItemsError(null);
    save.mutate({
      title: values.title.trim(),
      currency: values.currency.trim(),
      mode: values.mode,
      amount: values.amount.trim(),
      lineItems,
    });
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
      <Field
        label="Mode"
        hint="Ui links are paid from a hosted page. Api links are paid through your own integration."
      >
        <Select value={values.mode} onChange={set("mode")}>
          <option value="Ui">Ui</option>
          <option value="Api">Api</option>
        </Select>
      </Field>
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
        <Button type="submit" disabled={save.isPending}>
          {link ? "Save" : "Create link"}
        </Button>
      </div>
    </form>
  );
};

export const PaymentLinks = () => {
  const [editing, setEditing] = useState<PaymentLink | "new" | null>(null);
  const [deleting, setDeleting] = useState<PaymentLink | null>(null);

  const remove = useMutate<string>(
    "DELETE",
    (id) => `/api/payment-links/${id}`,
    {
      success: "Payment link deleted",
      onSuccess: () => setDeleting(null),
    },
  );

  return (
    <>
      <PageHeader
        title="Payment links"
        description="Reusable payment requests."
      />

      <DataTable<PaymentLink>
        path="/api/payment-links"
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
            header: "Mode",
            cell: (row) => (
              <Badge variant={row.mode === "Ui" ? "pending" : "neutral"}>
                {row.mode}
              </Badge>
            ),
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
        onConfirm={() => deleting && remove.mutate(deleting.id)}
      />
    </>
  );
};
