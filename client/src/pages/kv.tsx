import { Eraser, Pencil } from "lucide-react";
import { useState, type FormEvent } from "react";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Field } from "@/components/field";
import { PageHeader } from "@/components/page-header";
import { RowActions } from "@/components/row-actions";
import { SimpleTable } from "@/components/simple-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { formatDateTime } from "@/lib/format";
import { useGet, useMutate } from "@/lib/queries";

type KvRow = {
  key: string;
  type: "String" | "SecureString";
  isSet: boolean;
  value: string | null;
  updatedAt: string | null;
};

const KvForm = ({ row, onClose }: { row: KvRow; onClose: () => void }) => {
  const [value, setValue] = useState(
    row.type === "String" ? (row.value ?? "") : "",
  );
  const save = useMutate<{ value: string }>("PUT", `/api/admin/kv/${row.key}`, {
    success: "Value saved",
    onSuccess: onClose,
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    save.mutate({ value: value.trim() });
  };

  return (
    <form className="space-y-4" onSubmit={submit}>
      <Field
        label={row.key}
        hint={
          row.type === "SecureString"
            ? "Stored encrypted. It is never shown again."
            : undefined
        }
      >
        <Input
          required
          autoFocus
          type={row.type === "SecureString" ? "password" : "text"}
          autoComplete="off"
          value={value}
          onChange={(event) => setValue(event.target.value)}
        />
      </Field>
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" disabled={save.isPending || !value.trim()}>
          Save
        </Button>
      </div>
    </form>
  );
};

export const Kv = () => {
  const rows = useGet<KvRow[]>("/api/admin/kv");
  const [editing, setEditing] = useState<KvRow | null>(null);
  const [clearing, setClearing] = useState<KvRow | null>(null);

  const clear = useMutate<string>("DELETE", (key) => `/api/admin/kv/${key}`, {
    success: "Value cleared",
    onSuccess: () => setClearing(null),
  });

  return (
    <>
      <PageHeader
        title="KV"
        description="Provider credentials and identifiers the server needs. Secrets are encrypted and never shown."
      />

      <SimpleTable<KvRow>
        rows={rows.data}
        loading={rows.isLoading}
        error={rows.error}
        rowKey={(row) => row.key}
        searchPlaceholder="Search keys"
        searchText={(row) => row.key}
        columns={[
          {
            header: "Key",
            cell: (row) => <span className="font-medium">{row.key}</span>,
          },
          {
            header: "Type",
            cell: (row) => (
              <Badge
                variant={row.type === "SecureString" ? "pending" : "neutral"}
              >
                {row.type === "SecureString" ? "Secret" : "Text"}
              </Badge>
            ),
          },
          {
            header: "Value",
            cell: (row) =>
              !row.isSet ? (
                <Badge variant="warning">Not set</Badge>
              ) : row.type === "SecureString" ? (
                <span className="tracking-widest text-muted">••••••••</span>
              ) : (
                <span className="font-mono text-xs">{row.value}</span>
              ),
          },
          {
            header: "Updated",
            cell: (row) =>
              row.updatedAt ? formatDateTime(row.updatedAt) : "—",
          },
          {
            header: "",
            className: "w-12 text-right",
            cell: (row) => (
              <RowActions
                actions={[
                  {
                    label: row.isSet ? "Change" : "Set",
                    icon: <Pencil className="size-4" />,
                    onSelect: () => setEditing(row),
                  },
                  {
                    label: "Clear",
                    icon: <Eraser className="size-4" />,
                    danger: true,
                    hidden: !row.isSet,
                    onSelect: () => setClearing(row),
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
        title="Set value"
      >
        {editing && <KvForm row={editing} onClose={() => setEditing(null)} />}
      </Dialog>

      <ConfirmDialog
        open={clearing !== null}
        onOpenChange={(open) => !open && setClearing(null)}
        title="Clear value"
        description={`${clearing?.key} will be unset. Features that need it stop working until it is set again.`}
        confirmLabel="Clear value"
        pending={clear.isPending}
        onConfirm={() => clearing && clear.mutate(clearing.key)}
      />
    </>
  );
};
