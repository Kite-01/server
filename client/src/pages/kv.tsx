import { useQuery } from "@tanstack/react-query";
import { IconCircleCheck, IconPlugConnected } from "@tabler/icons-react";
import { useState, type FormEvent } from "react";
import {
  getApiKvOptions,
  getApiKvProvidersOptions,
  putApiKvByKeyMutation,
} from "@/api/@tanstack/react-query.gen";
import type { KvEntry, ProviderStatus } from "@/api/types.gen";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { SimpleTable } from "@/components/simple-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { formatDateTime } from "@/lib/format";
import { useMutate } from "@/lib/queries";
import { providerActionLabels } from "@/lib/providers";

type Key = ProviderStatus["keys"][number];

const keyLabels: Partial<Record<Key["key"], string>> = {
  AlchemyApiKey: "API key",
  AlchemyGasPolicyId: "Gas policy ID",
  QuickNodeApiKey: "API key",
};

const KeyField = ({ item, entry }: { item: Key; entry?: KvEntry }) => {
  const [value, setValue] = useState("");
  const secret = item.type === "SecureString";

  const save = useMutate(putApiKvByKeyMutation(), {
    success: "Saved",
    onSuccess: () => setValue(""),
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    save.mutate({ path: { key: item.key }, body: { value: value.trim() } });
  };

  const current = !item.set
    ? "Not set"
    : secret
      ? "Set, hidden"
      : (entry?.value ?? "Set");

  return (
    <form
      onSubmit={submit}
      className="grid gap-2 py-3 sm:grid-cols-[120px_minmax(0,1fr)_9.5rem] sm:items-center"
    >
      <div>
        <p className="text-sm">{keyLabels[item.key] ?? item.key}</p>
        <p className="text-xs text-muted">
          {item.required ? "Required" : "Optional"}
        </p>
      </div>
      <Input
        type={secret ? "password" : "text"}
        autoComplete="off"
        className="font-mono placeholder:font-sans"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        placeholder={
          item.set ? current : `Enter ${keyLabels[item.key] ?? "a value"}`
        }
        aria-label={keyLabels[item.key] ?? item.key}
      />
      <div className="flex gap-1 sm:justify-end">
        <Button
          type="submit"
          variant="outline"
          disabled={!value.trim() || save.isPending}
        >
          {item.set ? "Replace" : "Save"}
        </Button>
        {item.set && (
          <Button
            variant="ghost"
            className="text-muted hover:text-danger"
            disabled={save.isPending}
            onClick={() =>
              save.mutate({ path: { key: item.key }, body: { value: null } })
            }
          >
            Clear
          </Button>
        )}
      </div>
    </form>
  );
};

const ProviderCard = ({
  status,
  entries,
}: {
  status: ProviderStatus;
  entries: KvEntry[];
}) => (
  <Card className="px-5 pt-4 pb-2">
    <div className="flex items-start justify-between gap-3 pb-2">
      <div>
        <p className="font-display font-medium">{status.provider}</p>
        <p className="text-xs text-muted">
          {providerActionLabels[status.action]}
        </p>
      </div>
      {status.configured ? (
        <Badge variant="success">
          <IconCircleCheck className="size-3.5" />
          Ready
        </Badge>
      ) : (
        <Badge variant="warning">Needs keys</Badge>
      )}
    </div>
    <div className="divide-y divide-line border-t border-line">
      {status.keys.map((item) => (
        <KeyField
          key={item.key}
          item={item}
          entry={entries.find((entry) => entry.key === item.key)}
        />
      ))}
    </div>
  </Card>
);

export const Kv = () => {
  const rows = useQuery(getApiKvOptions());
  const providers = useQuery(getApiKvProvidersOptions());

  return (
    <div className="space-y-10">
      <section>
        <PageHeader
          title="KV"
          description="Keys your providers need. Chains can only use a gas sponsor or deposit notifier once its keys are set. Secrets are encrypted at rest."
        />

        {providers.data?.length === 0 ? (
          <Card>
            <EmptyState
              icon={IconPlugConnected}
              title="No providers"
              description="This server has no providers that need keys."
            />
          </Card>
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            {providers.data?.map((status) => (
              <ProviderCard
                key={`${status.provider}-${status.action}`}
                status={status}
                entries={rows.data ?? []}
              />
            ))}
          </div>
        )}
      </section>

      <section>
        <h2 className="mb-1 text-sm font-medium">Stored values</h2>
        <p className="mb-4 text-sm text-muted">
          Everything in the store, including what providers save for themselves.
        </p>

        <SimpleTable
          exportName="kv"
          rows={rows.data}
          loading={rows.isLoading}
          error={rows.error}
          rowKey={(row) => row.key}
          searchPlaceholder="Search keys"
          searchText={(row) => row.key}
          empty={{
            title: "Nothing stored yet",
            description: "Values appear here as you set provider keys above.",
          }}
          columns={[
            {
              header: "Key",
              cell: (row) => (
                <span className="font-mono text-xs">{row.key}</span>
              ),
            },
            {
              header: "Type",
              cell: (row) => (
                <Badge>{row.type === "SecureString" ? "Secret" : "Text"}</Badge>
              ),
            },
            {
              header: "Value",
              exportValue: (row) =>
                row.type === "SecureString" ? "" : (row.value ?? ""),
              cell: (row) =>
                row.value === null ? (
                  <span className="text-muted">Not set</span>
                ) : row.type === "SecureString" ? (
                  <span className="tracking-widest text-muted">••••••••</span>
                ) : (
                  <span className="font-mono text-xs">{row.value}</span>
                ),
            },
            {
              header: "Updated",
              cell: (row) => (
                <span className="text-muted">
                  {formatDateTime(row.updatedAt)}
                </span>
              ),
            },
          ]}
        />
      </section>
    </div>
  );
};
