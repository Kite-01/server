import {
  IconPencil,
  IconPlus,
  IconTrash,
  IconUserCircle,
} from "@tabler/icons-react";
import { useState, type FormEvent } from "react";
import {
  deleteApiCustomersByIdMutation,
  getApiCustomersOptions,
  postApiCustomersMutation,
} from "@/api/@tanstack/react-query.gen";
import type { Customer } from "@/api/types.gen";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { CopyButton } from "@/components/copy-button";
import { DataTable } from "@/components/data-table";
import { Field } from "@/components/field";
import { PageHeader } from "@/components/page-header";
import { RowActions } from "@/components/row-actions";
import {
  fromTraitRows,
  toTraitRows,
  TraitsBuilder,
} from "@/components/traits-builder";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { formatDate, initials, shortId } from "@/lib/format";
import { useAppHeaders, useMutate } from "@/lib/queries";

const CustomerForm = ({
  customer,
  onClose,
}: {
  customer?: Customer;
  onClose: () => void;
}) => {
  const [externalId, setExternalId] = useState(customer?.externalId ?? "");
  const [name, setName] = useState(customer?.name ?? "");
  const [traits, setTraits] = useState(() =>
    toTraitRows(customer?.traits ?? null),
  );
  const [traitsError, setTraitsError] = useState<string | null>(null);

  const headers = useAppHeaders();
  const save = useMutate(postApiCustomersMutation({ headers }), {
    success: customer ? "Customer updated" : "Customer created",
    onSuccess: onClose,
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();

    const result = fromTraitRows(traits);
    if ("error" in result) return setTraitsError(result.error);

    setTraitsError(null);
    save.mutate({
      body: {
        externalId: externalId.trim(),
        name: name.trim() || null,
        traits: result.traits,
      },
    });
  };

  return (
    <form className="space-y-4" onSubmit={submit}>
      <Field label="External ID" hint="Your own identifier for this customer.">
        <Input
          required
          disabled={!!customer}
          value={externalId}
          onChange={(event) => setExternalId(event.target.value)}
        />
      </Field>
      <Field label="Name">
        <Input value={name} onChange={(event) => setName(event.target.value)} />
      </Field>
      <Field
        label="Traits"
        hint="Optional. Fees can target customers by trait."
      >
        <TraitsBuilder rows={traits} onChange={setTraits} />
        {traitsError && <p className="text-xs text-danger">{traitsError}</p>}
      </Field>
      <div className="flex justify-end gap-2 pt-2">
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" disabled={save.isPending || !externalId.trim()}>
          {customer ? "Save" : "Create customer"}
        </Button>
      </div>
    </form>
  );
};

export const Customers = () => {
  const [editing, setEditing] = useState<Customer | "new" | null>(null);
  const [deleting, setDeleting] = useState<Customer | null>(null);
  const headers = useAppHeaders();

  const remove = useMutate(deleteApiCustomersByIdMutation({ headers }), {
    success: "Customer deleted",
    onSuccess: () => setDeleting(null),
  });

  return (
    <>
      <PageHeader title="Customers" />

      <DataTable
        exportName="customers"
        options={(query) => getApiCustomersOptions({ query, headers })}
        rowKey={(row) => row.id}
        searchPlaceholder="Search customers"
        empty={{
          icon: IconUserCircle,
          title: "No customers yet",
          description:
            "Add the people and businesses who pay, to group their payments.",
        }}
        toolbar={
          <Button onClick={() => setEditing("new")}>
            <IconPlus className="size-4" />
            New customer
          </Button>
        }
        columns={[
          {
            header: "Customer",
            exportValue: (row) => row.name ?? row.externalId,
            cell: (row) => (
              <div className="flex items-center gap-3">
                <span className="flex size-9 items-center justify-center rounded-full bg-pending/10 text-xs font-semibold text-pending">
                  {initials(row.name ?? row.externalId)}
                </span>
                <div>
                  <p className="font-medium font-display">
                    {row.name ?? row.externalId}
                  </p>
                </div>
              </div>
            ),
          },
          {
            header: "External ID",
            exportValue: (row) => row.externalId,
            cell: (row) => (
              <span className="flex items-center gap-1 text-xs">
                {row.externalId}
                <CopyButton value={row.externalId} />
              </span>
            ),
          },
          {
            header: "ID",
            exportValue: (row) => row.id,
            cell: (row) => (
              <span className="flex items-center gap-1 text-xs">
                {shortId(row.id)}...
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
        title={editing === "new" ? "New customer" : "Edit customer"}
      >
        {editing !== null && (
          <CustomerForm
            customer={editing === "new" ? undefined : editing}
            onClose={() => setEditing(null)}
          />
        )}
      </Dialog>

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title="Delete customer"
        description={`${deleting?.name ?? deleting?.externalId} will be removed. Customers with quotes cannot be deleted.`}
        confirmLabel="Delete customer"
        pending={remove.isPending}
        onConfirm={() =>
          deleting && remove.mutate({ path: { id: deleting.id } })
        }
      />
    </>
  );
};
