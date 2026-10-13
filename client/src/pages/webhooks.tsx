import { List, Plus, Trash2 } from "lucide-react";
import { useState, type FormEvent } from "react";
import {
  deleteApiWebhooksByIdMutation,
  getApiWebhooksByIdDeliveriesOptions,
  getApiWebhooksOptions,
  postApiWebhooksMutation,
} from "@/api/@tanstack/react-query.gen";
import type { Webhook } from "@/api/types.gen";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { CopyButton } from "@/components/copy-button";
import { DataTable } from "@/components/data-table";
import { CheckboxGroup, Field } from "@/components/field";
import { PageHeader } from "@/components/page-header";
import { RowActions } from "@/components/row-actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { formatDateTime } from "@/lib/format";
import { useAppHeaders, useMutate } from "@/lib/queries";

type Category = Webhook["categories"][number];

const categories = (
  ["Transfer", "Deposit", "Recovery", "ExcessRefund"] satisfies Category[]
).map((value) => ({
  value,
  label: value,
}));

const WebhookForm = ({
  onCreated,
  onClose,
}: {
  onCreated: (webhook: { label: string; signingKey: string }) => void;
  onClose: () => void;
}) => {
  const [values, setValues] = useState({
    label: "",
    url: "",
    maxRetries: "3",
    retryIntervalInSeconds: "10",
    timeoutInSeconds: "30",
  });
  const [selected, setSelected] = useState<Category[]>(["Transfer"]);

  const headers = useAppHeaders();
  const create = useMutate(postApiWebhooksMutation({ headers }));

  const set =
    (key: keyof typeof values) => (event: { target: { value: string } }) =>
      setValues({ ...values, [key]: event.target.value });

  const submit = (event: FormEvent) => {
    event.preventDefault();

    create.mutate(
      {
        body: {
          label: values.label.trim(),
          url: values.url.trim(),
          categories: selected,
          maxRetries: Number(values.maxRetries),
          retryIntervalInSeconds: Number(values.retryIntervalInSeconds),
          timeoutInSeconds: Number(values.timeoutInSeconds),
        },
      },
      { onSuccess: onCreated },
    );
  };

  return (
    <form className="space-y-4" onSubmit={submit}>
      <Field label="Label">
        <Input required value={values.label} onChange={set("label")} />
      </Field>
      <Field label="Endpoint URL">
        <Input
          required
          type="url"
          value={values.url}
          onChange={set("url")}
          placeholder="https://"
        />
      </Field>
      <Field label="Events">
        <CheckboxGroup
          options={categories}
          value={selected}
          onChange={setSelected}
        />
      </Field>
      <div className="grid grid-cols-3 gap-3">
        <Field label="Retries">
          <Input
            type="number"
            min={0}
            max={20}
            value={values.maxRetries}
            onChange={set("maxRetries")}
          />
        </Field>
        <Field label="Retry delay (s)">
          <Input
            type="number"
            min={1}
            value={values.retryIntervalInSeconds}
            onChange={set("retryIntervalInSeconds")}
          />
        </Field>
        <Field label="Timeout (s)">
          <Input
            type="number"
            min={1}
            max={120}
            value={values.timeoutInSeconds}
            onChange={set("timeoutInSeconds")}
          />
        </Field>
      </div>
      <div className="flex justify-end gap-2 pt-2">
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button
          type="submit"
          disabled={create.isPending || selected.length === 0}
        >
          Create webhook
        </Button>
      </div>
    </form>
  );
};

const Deliveries = ({ webhook }: { webhook: Webhook }) => {
  const headers = useAppHeaders();

  return (
    <DataTable
      options={(query) =>
        getApiWebhooksByIdDeliveriesOptions({
          path: { id: webhook.id },
          query,
          headers,
        })
      }
      rowKey={(row) => row.id}
      empty="No deliveries yet"
      pageSize={8}
      columns={[
        { header: "Attempt", cell: (row) => `#${row.attempt}` },
        {
          header: "Result",
          cell: (row) =>
            row.httpResponseCode ? (
              <Badge
                variant={row.httpResponseCode < 300 ? "success" : "danger"}
              >
                HTTP {row.httpResponseCode}
              </Badge>
            ) : row.error ? (
              <Badge variant="danger">{row.error}</Badge>
            ) : (
              <Badge variant="pending">In flight</Badge>
            ),
        },
        { header: "Started", cell: (row) => formatDateTime(row.startedAt) },
        {
          header: "Next retry",
          cell: (row) =>
            row.nextRetryAt ? formatDateTime(row.nextRetryAt) : "—",
        },
      ]}
    />
  );
};

export const Webhooks = () => {
  const [creating, setCreating] = useState(false);
  const [secret, setSecret] = useState<{
    label: string;
    signingKey: string;
  } | null>(null);
  const [viewing, setViewing] = useState<Webhook | null>(null);
  const [deleting, setDeleting] = useState<Webhook | null>(null);
  const headers = useAppHeaders();

  const remove = useMutate(deleteApiWebhooksByIdMutation({ headers }), {
    success: "Webhook deleted",
    onSuccess: () => setDeleting(null),
  });

  return (
    <>
      <PageHeader
        title="Webhooks"
        description="Endpoints that receive signed events when payments change."
      />

      <DataTable
        options={(query) => getApiWebhooksOptions({ query, headers })}
        rowKey={(row) => row.id}
        searchPlaceholder="Search webhooks"
        empty="No webhooks yet"
        toolbar={
          <Button onClick={() => setCreating(true)}>
            <Plus className="size-4" />
            New webhook
          </Button>
        }
        columns={[
          {
            header: "Webhook",
            cell: (row) => (
              <div className="min-w-0">
                <p className="font-medium">{row.label}</p>
                <p className="max-w-xs truncate text-xs text-muted">
                  {row.url}
                </p>
              </div>
            ),
          },
          {
            header: "Events",
            cell: (row) => (
              <div className="flex flex-wrap gap-1">
                {row.categories.map((category) => (
                  <Badge key={category} variant="neutral">
                    {category}
                  </Badge>
                ))}
              </div>
            ),
          },
          {
            header: "Signing key",
            cell: (row) => (
              <span className="font-mono text-xs">{row.signingKeyHint}</span>
            ),
          },
          { header: "Retries", cell: (row) => row.maxRetries },
          { header: "Created", cell: (row) => formatDateTime(row.createdAt) },
          {
            header: "",
            className: "w-12 text-right",
            cell: (row) => (
              <RowActions
                actions={[
                  {
                    label: "Deliveries",
                    icon: <List className="size-4" />,
                    onSelect: () => setViewing(row),
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

      <Dialog open={creating} onOpenChange={setCreating} title="New webhook">
        <WebhookForm
          onClose={() => setCreating(false)}
          onCreated={(webhook) => {
            setCreating(false);
            setSecret(webhook);
          }}
        />
      </Dialog>

      <Dialog
        open={secret !== null}
        onOpenChange={(open) => !open && setSecret(null)}
        title="Save the signing key"
        description="Use it to verify the X-Kite-Signature header. It is shown once."
      >
        {secret && (
          <div className="space-y-4">
            <div className="flex items-center gap-1">
              <Input readOnly className="font-mono" value={secret.signingKey} />
              <CopyButton value={secret.signingKey} />
            </div>
            <div className="flex justify-end">
              <Button onClick={() => setSecret(null)}>I have saved it</Button>
            </div>
          </div>
        )}
      </Dialog>

      <Dialog
        open={viewing !== null}
        onOpenChange={(open) => !open && setViewing(null)}
        title={viewing ? `Deliveries · ${viewing.label}` : "Deliveries"}
        className="max-w-2xl"
      >
        {viewing && <Deliveries webhook={viewing} />}
      </Dialog>

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title="Delete webhook"
        description={`${deleting?.label} stops receiving events.`}
        confirmLabel="Delete webhook"
        pending={remove.isPending}
        onConfirm={() =>
          deleting && remove.mutate({ path: { id: deleting.id } })
        }
      />
    </>
  );
};
