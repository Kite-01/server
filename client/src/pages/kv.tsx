import { useQuery } from "@tanstack/react-query";
import {
  IconDatabase,
  IconEye,
  IconEyeOff,
  IconPencil,
  IconPlus,
  IconTrash,
} from "@tabler/icons-react";
import { useState, type FormEvent } from "react";
import {
  kvDeleteMutation,
  kvListOptions,
  kvSetMutation,
} from "@/api/@tanstack/react-query.gen";
import type { KvEntry, ProviderStatus } from "@/api/types.gen";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { CopyButton } from "@/components/copy-button";
import { Field } from "@/components/field";
import { PageHeader } from "@/components/page-header";
import { RowActions } from "@/components/row-actions";
import { SimpleTable } from "@/components/simple-table";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input, Select } from "@/components/ui/input";
import { formatDateTime } from "@/lib/format";
import { useMutate } from "@/lib/queries";
import None from "@/components/none";

type KeyType = KvEntry["type"];

// The keys the server reads, with the type it stores each as.
const keyTypes: Record<ProviderStatus["keys"][number]["key"], KeyType> = {
  AlchemyApiKey: "SecureString",
  AlchemyGasPolicyId: "String",
  AlchemyAuthToken: "SecureString",
  QuickNodeApiKey: "SecureString",
  QuickNodeEvmWalletFilter_WalletsListName: "String",
  QuickNodeEvmContractEvents_ContractsListName: "String",
  QuickNodeEvmContractEvents_EventHashesListName: "String",
  QuickNodeWebhookSecurityToken: "SecureString",
  ThirdwebSecretKey: "SecureString",
  NearIntentsApiKey: "SecureString",
};

// Stored as `<prefix>:<network>`, with the provider's name for the network.
const networkKeys: Record<string, { type: KeyType; example: string }> = {
  AlchemyAddressActivity_Webhook: {
    type: "SecureString",
    example: "BASE_MAINNET",
  },
  AlchemyContractEvents_Webhook: {
    type: "SecureString",
    example: "BASE_MAINNET",
  },
  QuickNodeEvmWalletFilter_WebhookId: {
    type: "String",
    example: "base-mainnet",
  },
  QuickNodeEvmContractEvents_WebhookId: {
    type: "String",
    example: "base-mainnet",
  },
};

const typeOf = (key: string): KeyType | undefined => {
  const [name, network] = key.split(":");
  return network === undefined
    ? keyTypes[name as keyof typeof keyTypes]
    : networkKeys[name]?.type;
};

const Value = ({ entry }: { entry: KvEntry }) => {
  const [shown, setShown] = useState(false);
  if (entry.value === null) return <None />;

  const hidden = entry.type === "SecureString" && !shown;

  return (
    <span className="flex items-center gap-1">
      <span
        className="max-w-xs truncate text-sm"
        title={hidden ? undefined : entry.value}
      >
        {hidden ? "********" : entry.value}
      </span>
      {entry.type === "SecureString" && (
        <Button
          variant="ghost"
          size="iconSm"
          aria-label={shown ? "Hide value" : "Show value"}
          onClick={() => setShown(!shown)}
        >
          {shown ? (
            <IconEyeOff className="size-3.5" />
          ) : (
            <IconEye className="size-3.5" />
          )}
        </Button>
      )}
      <CopyButton value={entry.value} />
    </span>
  );
};

const KvForm = ({
  entry,
  taken,
  onClose,
}: {
  entry?: KvEntry;
  taken: string[];
  onClose: () => void;
}) => {
  const names = [
    ...Object.keys(keyTypes).filter((name) => !taken.includes(name)),
    ...Object.keys(networkKeys),
  ];
  const [name, setName] = useState(names[0] ?? "");
  const [network, setNetwork] = useState("");
  const key =
    entry?.key ?? (name in networkKeys ? `${name}:${network.trim()}` : name);
  const secret = (entry?.type ?? typeOf(key)) === "SecureString";
  const [value, setValue] = useState(
    entry && !secret ? (entry.value ?? "") : "",
  );

  const save = useMutate(kvSetMutation(), {
    success: "Value saved",
    onSuccess: onClose,
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    save.mutate({ path: { key }, body: { value: value.trim() } });
  };

  return (
    <form className="space-y-4" onSubmit={submit}>
      <Field label="Key">
        {entry ? (
          <Input disabled value={entry.key} />
        ) : (
          <Select
            value={name}
            onChange={(event) => setName(event.target.value)}
          >
            {names.map((option) => (
              <option key={option} value={option}>
                {option in networkKeys ? `${option}:<network>` : option}
              </option>
            ))}
          </Select>
        )}
      </Field>
      {!entry && name in networkKeys && (
        <Field label="Network" hint="The provider's name for the network.">
          <Input
            required
            pattern="[A-Za-z0-9_\-]+"
            value={network}
            onChange={(event) => setNetwork(event.target.value)}
            placeholder={networkKeys[name].example}
          />
        </Field>
      )}
      <Field label="Value">
        <Input
          required
          type={secret ? "password" : "text"}
          autoComplete="off"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          placeholder={entry && secret ? "Enter a new value" : undefined}
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
  const rows = useQuery(kvListOptions());
  const [editing, setEditing] = useState<KvEntry | "new" | null>(null);
  const [deleting, setDeleting] = useState<KvEntry | null>(null);

  const remove = useMutate(kvDeleteMutation(), {
    success: "Value deleted",
    onSuccess: () => setDeleting(null),
  });

  return (
    <>
      <PageHeader title="KV" />

      <SimpleTable
        exportName="kv"
        rows={
          rows.data && [...rows.data].sort((a, b) => a.key.localeCompare(b.key))
        }
        loading={rows.isLoading}
        error={rows.error}
        rowKey={(row) => row.key}
        searchPlaceholder="Search keys"
        searchText={(row) => row.key}
        empty={{
          icon: IconDatabase,
          title: "No values yet",
          description:
            "Provider keys and the webhook details the server saves are listed here.",
        }}
        toolbar={
          <Button onClick={() => setEditing("new")}>
            <IconPlus className="size-4" />
            New value
          </Button>
        }
        columns={[
          {
            header: "Key",
            cell: (row) => <span className="font-medium">{row.key}</span>,
          },

          {
            header: "Value",
            exportValue: (row) =>
              row.type === "SecureString" ? null : row.value,
            cell: (row) => <Value entry={row} />,
          },
          {
            header: "Last updated",
            cell: (row) => formatDateTime(row.updatedAt),
          },
          {
            header: "",
            className: "w-12 text-right",
            cell: (row) => (
              <RowActions
                actions={[
                  {
                    label: "Edit",
                    icon: <IconPencil className="size-4" />,
                    hidden: !typeOf(row.key),
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
        title={editing === "new" ? "New value" : "Edit value"}
      >
        {editing && (
          <KvForm
            entry={editing === "new" ? undefined : editing}
            taken={rows.data?.map((row) => row.key) ?? []}
            onClose={() => setEditing(null)}
          />
        )}
      </Dialog>

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title="Delete value"
        description={`The server treats ${deleting?.key} as unset from now on.`}
        confirmLabel="Delete value"
        pending={remove.isPending}
        onConfirm={() =>
          deleting && remove.mutate({ path: { key: deleting.key } })
        }
      />
    </>
  );
};
