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
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input, Textarea } from "@/components/ui/input";
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
  const [traits, setTraits] = useState(
    customer?.traits ? JSON.stringify(customer.traits, null, 2) : "",
  );
  const [traitsError, setTraitsError] = useState<string | null>(null);

  const headers = useAppHeaders();
  const save = useMutate(postApiCustomersMutation({ headers }), {
    success: customer ? "Customer updated" : "Customer created",
    onSuccess: onClose,
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();

    let parsed: Customer["traits"] = null;
    if (traits.trim()) {
      try {
        parsed = JSON.parse(traits);
      } catch {
        return setTraitsError("Traits must be valid JSON");
      }
    }

    if (
      parsed !== null &&
      (typeof parsed !== "object" || Array.isArray(parsed))
    ) {
      return setTraitsError("Traits must be a JSON object");
    }

    setTraitsError(null);
    save.mutate({
      body: {
        externalId: externalId.trim(),
        name: name.trim() || null,
        traits: parsed,
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
        hint="Optional JSON object. Fees can target customers by trait."
      >
        <Textarea
          value={traits}
          onChange={(event) => setTraits(event.target.value)}
          placeholder='{ "plan": "pro" }'
        />
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
      <PageHeader
        title="Customers"
        description="People and businesses paying through this app."
      />

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
            cell: (row) => (
              <div className="flex items-center gap-3">
                <span className="flex size-9 items-center justify-center rounded-full bg-brand-soft text-xs font-semibold text-brand">
                  {initials(row.name ?? row.externalId)}
                </span>
                <div>
                  <p className="font-medium">{row.name ?? row.externalId}</p>
                  {row.name && (
                    <p className="text-xs text-muted">{row.externalId}</p>
                  )}
                </div>
              </div>
            ),
          },
          {
            header: "Traits",
            cell: (row) =>
              row.traits && Object.keys(row.traits).length > 0 ? (
                <code className="text-xs">
                  {JSON.stringify(row.traits).slice(0, 60)}
                </code>
              ) : (
                <span className="text-muted">—</span>
              ),
          },
          {
            header: "ID",
            exportValue: (row) => row.id,
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
