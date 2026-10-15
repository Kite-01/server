import {
  IconChevronDown,
  IconDownload,
  IconKey,
  IconPencil,
  IconPlus,
  IconShieldOff,
  IconTrash,
} from "@tabler/icons-react";
import { useState, type FormEvent } from "react";
import {
  deleteApiApiKeyByIdMutation,
  getApiApiKeyOptions,
  patchApiApiKeyByIdMutation,
  postApiApiKeyByIdRevokeMutation,
  postApiApiKeyMutation,
} from "@/api/@tanstack/react-query.gen";
import type { ApiKey } from "@/api/types.gen";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { CopyButton } from "@/components/copy-button";
import { DataTable } from "@/components/data-table";
import { Field } from "@/components/field";
import { PageHeader } from "@/components/page-header";
import { RowActions } from "@/components/row-actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input, Textarea } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { formatDateTime, shortId } from "@/lib/format";
import { useAppHeaders, useMutate } from "@/lib/queries";
import { generateKeyPair } from "@/lib/signing";
import None from "@/components/none";

type Scope = ApiKey["scopes"][number];

const scopeGroups: { label: string; scopes: [string, Scope][] }[] = [
  {
    label: "API keys",
    scopes: [
      ["read", "Apikey:Read"],
      ["write", "Apikey:Write"],
      ["delete", "Apikey:Delete"],
    ],
  },
  {
    label: "App",
    scopes: [
      ["write", "App:Write"],
      ["delete", "App:Delete"],
    ],
  },
  {
    label: "Customers",
    scopes: [
      ["read", "Customer:Read"],
      ["write", "Customer:Write"],
      ["delete", "Customer:Delete"],
    ],
  },
  {
    label: "Fees",
    scopes: [
      ["read", "Fee:Read"],
      ["write", "Fee:Write"],
      ["delete", "Fee:Delete"],
    ],
  },
  {
    label: "Payment links",
    scopes: [
      ["read", "PaymentLink:Read"],
      ["write", "PaymentLink:Write"],
      ["delete", "PaymentLink:Delete"],
    ],
  },
  {
    label: "Quotes",
    scopes: [
      ["read", "quotes:read"],
      ["write", "quotes:write"],
    ],
  },
  {
    label: "Transfers",
    scopes: [
      ["read", "Transfer:Read"],
      ["write", "Transfer:Write"],
    ],
  },
  {
    label: "Webhooks",
    scopes: [
      ["read", "Webhook:Read"],
      ["write", "Webhook:Write"],
      ["delete", "Webhook:Delete"],
    ],
  },
  { label: "x402 payments", scopes: [["", "x402"]] },
];

const status = (key: ApiKey) =>
  key.revokedAt
    ? "Revoked"
    : key.expiresAt && new Date(key.expiresAt) < new Date()
      ? "Expired"
      : "Active";

const NewKeyForm = ({
  onCreated,
  onClose,
}: {
  onCreated: (created: {
    id: string;
    privateKey: string;
    label: string;
  }) => void;
  onClose: () => void;
}) => {
  const [label, setLabel] = useState("");
  const [scopes, setScopes] = useState<Scope[]>([]);
  const [origins, setOrigins] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [error, setError] = useState<string | null>(null);

  const headers = useAppHeaders();
  const create = useMutate(postApiApiKeyMutation({ headers }));

  const toggle = (scope: Scope) =>
    setScopes((current) =>
      current.includes(scope)
        ? current.filter((s) => s !== scope)
        : [...current, scope],
    );

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);

    let pair: Awaited<ReturnType<typeof generateKeyPair>>;
    try {
      pair = await generateKeyPair();
    } catch {
      return setError("This browser cannot generate Ed25519 keys");
    }

    const list = origins.split(/[\s,]+/).filter(Boolean);
    create.mutate(
      {
        body: {
          label: label.trim(),
          publicKey: pair.publicKey,
          scopes,
          ...(list.length ? { allowedOrigins: list } : {}),
          ...(expiresAt
            ? { expiresAt: new Date(expiresAt).toISOString() }
            : {}),
        },
      },
      {
        onSuccess: (created) =>
          onCreated({
            id: created.id,
            privateKey: pair.privateKey,
            label: label.trim(),
          }),
      },
    );
  };

  return (
    <form className="space-y-4" onSubmit={submit}>
      <Field label="Label">
        <Input
          required
          value={label}
          onChange={(event) => setLabel(event.target.value)}
        />
      </Field>

      <div className="space-y-2">
        <p className="text-xs font-medium text-muted">Scopes</p>
        <div className="divide-y divide-line rounded-xl border border-line">
          {scopeGroups.map((group) => {
            const selectedCount = group.scopes.filter(([, scope]) =>
              scopes.includes(scope),
            ).length;

            return (
              <details key={group.label} className="group py-1 px-3">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-3 py-2 text-sm [&::-webkit-details-marker]:hidden">
                  <span className="text-[13px]">{group.label}</span>
                  <span className="flex items-center gap-2 text-xs text-muted">
                    {`${selectedCount}/${group.scopes.length} selected`}
                    <IconChevronDown className="size-4 transition-transform group-open:rotate-180" />
                  </span>
                </summary>
                <div className="flex flex-wrap gap-x-5 gap-y-2 pb-3 pt-1 text-xs">
                  {group.scopes.map(([action, scope]) => (
                    <label
                      key={scope}
                      className="flex items-center gap-1.5 capitalize"
                    >
                      <Switch
                        checked={scopes.includes(scope)}
                        onCheckedChange={() => toggle(scope)}
                      />
                      {action}
                    </label>
                  ))}
                </div>
              </details>
            );
          })}
        </div>
      </div>

      <Field
        label="Allowed origins"
        hint="Optional. Browser origins allowed to use this key's public key, separated by spaces or commas."
      >
        <Textarea
          className="min-h-16"
          value={origins}
          onChange={(event) => setOrigins(event.target.value)}
          placeholder="https://shop.example"
        />
      </Field>
      <Field label="Expires">
        <Input
          type="date"
          value={expiresAt}
          min={new Date().toISOString().slice(0, 10)}
          onChange={(event) => setExpiresAt(event.target.value)}
        />
      </Field>

      {error && <p className="text-sm text-danger">{error}</p>}

      <div className="flex justify-end gap-2 pt-2">
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" disabled={create.isPending || !label.trim()}>
          Generate key
        </Button>
      </div>
    </form>
  );
};

export const ApiKeys = () => {
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState<{
    id: string;
    privateKey: string;
    label: string;
  } | null>(null);
  const [renaming, setRenaming] = useState<ApiKey | null>(null);
  const [label, setLabel] = useState("");
  const [revoking, setRevoking] = useState<ApiKey | null>(null);
  const [deleting, setDeleting] = useState<ApiKey | null>(null);

  const headers = useAppHeaders();

  const rename = useMutate(patchApiApiKeyByIdMutation({ headers }), {
    success: "Label updated",
    onSuccess: () => setRenaming(null),
  });

  const revoke = useMutate(postApiApiKeyByIdRevokeMutation({ headers }), {
    success: "Key revoked",
    onSuccess: () => setRevoking(null),
  });

  const remove = useMutate(deleteApiApiKeyByIdMutation({ headers }), {
    success: "Key deleted",
    onSuccess: () => setDeleting(null),
  });

  const download = () => {
    if (!created) return;
    const file = new Blob(
      [
        JSON.stringify(
          { keyId: created.id, privateKey: created.privateKey },
          null,
          2,
        ),
      ],
      { type: "application/json" },
    );
    const link = document.createElement("a");
    link.href = URL.createObjectURL(file);
    link.download = `kite-api-key-${created.id.slice(0, 8)}.json`;
    link.click();
    URL.revokeObjectURL(link.href);
  };

  return (
    <>
      <PageHeader title="API keys" />

      <DataTable
        exportName="api-keys"
        options={(query) => getApiApiKeyOptions({ query, headers })}
        rowKey={(row) => row.id}
        searchPlaceholder="Search API keys"
        empty={{
          icon: IconKey,
          title: "No API keys yet",
          description:
            "Create a key to call the API from your backend. Its private key never leaves your browser.",
        }}
        toolbar={
          <Button onClick={() => setCreating(true)}>
            <IconPlus className="size-4" />
            New API key
          </Button>
        }
        columns={[
          {
            header: "ID",
            exportValue: (row) => row.id,
            cell: (row) => (
              <span className="flex items-center">
                {shortId(row.id)}...
                <CopyButton value={row.id} />
              </span>
            ),
          },
          {
            header: "Label",
            cell: (row) => <span className="font-medium">{row.label}</span>,
          },
          {
            header: "Scopes",
            cell: (row) =>
              row.scopes.length === 0 ? (
                <None />
              ) : (
                <span title={row.scopes.join(", ")}>
                  {row.scopes.length} granted
                </span>
              ),
          },
          {
            header: "Allowed origins",
            cell: (row) =>
              row.allowedOrigins?.join(", ") || <None text="Any" />,
          },
          {
            header: "Last used",
            cell: (row) =>
              row.lastUsedAt ? (
                formatDateTime(row.lastUsedAt)
              ) : (
                <None text="Never" />
              ),
          },
          {
            header: "Status",
            cell: (row) => {
              const value = status(row);
              return (
                <Badge variant={value === "Active" ? "success" : "danger"}>
                  {value}
                </Badge>
              );
            },
          },
          {
            header: "",
            className: "w-12 text-right",
            cell: (row) => (
              <RowActions
                actions={[
                  {
                    label: "Rename",
                    icon: <IconPencil className="size-4" />,
                    onSelect: () => {
                      setLabel(row.label);
                      setRenaming(row);
                    },
                  },
                  {
                    label: "Revoke",
                    icon: <IconShieldOff className="size-4" />,
                    hidden: !!row.revokedAt,
                    onSelect: () => setRevoking(row),
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

      <Dialog open={creating} onOpenChange={setCreating} title="New API key">
        <NewKeyForm
          onClose={() => setCreating(false)}
          onCreated={(result) => {
            setCreating(false);
            setCreated(result);
          }}
        />
      </Dialog>

      <Dialog
        open={created !== null}
        onOpenChange={(open) => !open && setCreated(null)}
        title="Save your private key"
        description="It is shown once and cannot be recovered. The server only stores the public key."
      >
        {created && (
          <div className="space-y-4">
            <Field label="Key ID">
              <div className="flex items-center gap-1">
                <Input readOnly className="font-mono" value={created.id} />
                <CopyButton value={created.id} />
              </div>
            </Field>
            <Field label="Private key (PKCS#8, base64url)">
              <div className="flex items-start gap-1">
                <Textarea
                  readOnly
                  className="min-h-20"
                  value={created.privateKey}
                />
                <CopyButton value={created.privateKey} />
              </div>
            </Field>
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={download}>
                <IconDownload className="size-4" />
                Download
              </Button>
              <Button onClick={() => setCreated(null)}>I have saved it</Button>
            </div>
          </div>
        )}
      </Dialog>

      <Dialog
        open={renaming !== null}
        onOpenChange={(open) => !open && setRenaming(null)}
        title="Rename API key"
      >
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (renaming)
              rename.mutate({
                path: { id: renaming.id },
                body: { label: label.trim() },
              });
          }}
        >
          <Field label="Label">
            <Input
              required
              value={label}
              onChange={(event) => setLabel(event.target.value)}
            />
          </Field>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setRenaming(null)}>
              Cancel
            </Button>
            <Button type="submit" disabled={rename.isPending || !label.trim()}>
              Save
            </Button>
          </div>
        </form>
      </Dialog>

      <ConfirmDialog
        open={revoking !== null}
        onOpenChange={(open) => !open && setRevoking(null)}
        title="Revoke API key"
        description={`${revoking?.label} stops working immediately. This cannot be undone.`}
        confirmLabel="Revoke key"
        pending={revoke.isPending}
        onConfirm={() =>
          revoking && revoke.mutate({ path: { id: revoking.id } })
        }
      />

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title="Delete API key"
        description={`${deleting?.label} is removed for good.`}
        confirmLabel="Delete key"
        pending={remove.isPending}
        onConfirm={() =>
          deleting && remove.mutate({ path: { id: deleting.id } })
        }
      />
    </>
  );
};
