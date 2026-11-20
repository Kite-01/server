import { useQuery } from "@tanstack/react-query";
import { IconChevronRight, IconPlugConnected } from "@tabler/icons-react";
import { useState, type FormEvent } from "react";
import {
  kvListOptions,
  kvListProvidersOptions,
  kvSetMutation,
} from "@/api/@tanstack/react-query.gen";
import type { KvEntry, ProviderStatus } from "@/api/types.gen";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useMutate } from "@/lib/queries";
import { providerActionLabels } from "@/lib/providers";
import { cn } from "@/lib/utils";

type Key = ProviderStatus["keys"][number];

const keyLabels: Partial<Record<Key["key"], string>> = {
  AlchemyApiKey: "API key",
  AlchemyGasPolicyId: "Gas policy ID",
  AlchemyAuthToken: "Auth token",
  QuickNodeApiKey: "API key",
  ThirdwebSecretKey: "Secret key",
  NearIntentsApiKey: "API key",
};

const KeyField = ({ item, entry }: { item: Key; entry?: KvEntry }) => {
  const [value, setValue] = useState("");
  const secret = item.type === "SecureString";

  const save = useMutate(kvSetMutation(), {
    success: "Saved",
    onSuccess: () => setValue(""),
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    save.mutate({ path: { key: item.key }, body: { value: value.trim() } });
  };

  return (
    <form
      onSubmit={submit}
      className="grid gap-2 py-3 sm:grid-cols-[120px_minmax(0,1fr)_9.5rem] sm:items-center"
    >
      <div>
        <p className="text-sm">
          {keyLabels[item.key] ?? item.key}&nbsp;
          {!item.required ? "(optional)" : null}
        </p>
      </div>

      <Input
        type={secret ? "password" : "text"}
        autoComplete="off"
        className="placeholder:font-sans h-11"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        placeholder={entry?.value ? entry.value : "Enter text"}
        aria-label={keyLabels[item.key] ?? item.key}
      />

      <div className="flex gap-1 sm:justify-end">
        <Button type="submit" disabled={!value.trim() || save.isPending}>
          Save
        </Button>
      </div>
    </form>
  );
};

const ProviderItem = ({
  status,
  entries,
}: {
  status: ProviderStatus;
  entries: KvEntry[];
}) => {
  const [open, setOpen] = useState(false);
  const id = `provider-${status.provider}-${status.action}`;

  return (
    <div>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center gap-3 px-5 py-4 text-left"
      >
        <IconChevronRight
          className={cn(
            "size-4 shrink-0 text-muted transition-transform duration-200",
            open && "rotate-90",
          )}
        />

        <div className="min-w-0 flex-1">
          <p className="font-display font-medium">{status.provider}</p>
          <p className="text-xs text-muted">
            {providerActionLabels[status.action]}
          </p>
        </div>

        {status.configured ? (
          <Badge variant="success">All set</Badge>
        ) : (
          <Badge variant="warning">Needs keys</Badge>
        )}
      </button>

      {open && (
        <div id={id} className="divide-y divide-line border-t border-line px-5">
          {status.keys.map((item) => (
            <KeyField
              key={item.key}
              item={item}
              entry={entries.find((entry) => entry.key === item.key)}
            />
          ))}
        </div>
      )}
    </div>
  );
};

export const Providers = () => {
  const rows = useQuery(kvListOptions());
  const providers = useQuery(kvListProvidersOptions());

  return (
    <>
      <PageHeader title="Providers" />

      {providers.isLoading ? (
        <Card
          className="divide-y divide-line"
          aria-busy="true"
          aria-label="Loading"
        >
          {[0, 1].map((row) => (
            <div key={row} className="flex items-center gap-3 px-5 py-4">
              <Skeleton className="size-4 shrink-0" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-3 w-36" />
              </div>
              <Skeleton className="h-6 w-16" />
            </div>
          ))}
        </Card>
      ) : providers.data?.length === 0 ? (
        <Card>
          <EmptyState
            icon={IconPlugConnected}
            title="No providers"
            description="This server has no providers that need keys."
          />
        </Card>
      ) : (
        <Card className="divide-y divide-line">
          {providers.data?.map((status) => (
            <ProviderItem
              key={`${status.provider}-${status.action}`}
              status={status}
              entries={rows.data ?? []}
            />
          ))}
        </Card>
      )}
    </>
  );
};
