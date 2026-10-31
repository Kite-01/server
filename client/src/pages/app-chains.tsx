import { useQuery } from "@tanstack/react-query";
import { IconBlocks, IconPencil } from "@tabler/icons-react";
import { useState, type FormEvent } from "react";
import {
  appsListChainsOptions,
  appsRemoveChainMutation,
  appsSetChainMutation,
  chainsListOptions,
} from "@/api/@tanstack/react-query.gen";
import type { ConfiguredChain } from "@/api/types.gen";
import { CopyButton } from "@/components/copy-button";
import { Field } from "@/components/field";
import { PageHeader } from "@/components/page-header";
import { RowActions } from "@/components/row-actions";
import { SimpleTable } from "@/components/simple-table";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { shortAddress } from "@/lib/format";
import { useAppHeaders, useMutate } from "@/lib/queries";
import None from "@/components/none";

const AddressForm = ({
  chain,
  address,
  onClose,
}: {
  chain: ConfiguredChain;
  address?: string;
  onClose: () => void;
}) => {
  const headers = useAppHeaders();
  const [value, setValue] = useState(address ?? "");
  const save = useMutate(appsSetChainMutation({ headers }), {
    success: "Address saved",
    onSuccess: onClose,
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    save.mutate({
      path: { chainId: chain.id },
      body: { address: value.trim() },
    });
  };

  return (
    <form className="space-y-4" onSubmit={submit}>
      <Field
        label="Address"
        hint={`Payments on ${chain.name} settle here when they aren't paid out, and NEAR Intents refunds come back here.`}
      >
        <Input
          required
          value={value}
          onChange={(event) => setValue(event.target.value)}
        />
      </Field>
      <div className="flex justify-end gap-2 pt-2">
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

export const AppChains = () => {
  const headers = useAppHeaders();
  const chains = useQuery(chainsListOptions({ headers }));
  const accepted = useQuery(appsListChainsOptions({ headers }));
  const [editing, setEditing] = useState<ConfiguredChain | null>(null);
  const remove = useMutate(appsRemoveChainMutation({ headers }), {
    success: "Payments turned off",
  });

  const addressOf = (chainId: string) =>
    accepted.data?.data.find((row) => row.chainId === chainId)?.address;

  return (
    <>
      <PageHeader title="Chains" />

      <SimpleTable
        exportName="app-chains"
        rows={accepted.data ? chains.data?.data : undefined}
        loading={chains.isLoading || accepted.isLoading}
        error={chains.error ?? accepted.error}
        rowKey={(row) => row.id}
        searchPlaceholder="Search chains"
        searchText={(row) => `${row.name} ${row.caip2Id}`}
        empty={{
          icon: IconBlocks,
          title: "No chains yet",
          description: "Chains show up here once they are configured.",
        }}
        columns={[
          {
            header: "Chain",
            cell: (row) => <p className="font-medium">{row.name}</p>,
          },
          {
            header: "Settlement token",
            cell: (row) => row.settlementToken.symbol,
          },
          {
            header: "Address",
            exportValue: (row) => addressOf(row.id) ?? "",
            cell: (row) => {
              const address = addressOf(row.id);
              return address ? (
                <span className="flex items-center">
                  {shortAddress(address)}
                  <CopyButton value={address} />
                </span>
              ) : (
                <None />
              );
            },
          },
          {
            header: "Accept payments",
            exportValue: (row) => (addressOf(row.id) ? "Yes" : "No"),
            cell: (row) => (
              <Switch
                checked={!!addressOf(row.id)}
                disabled={remove.isPending}
                onCheckedChange={(on) =>
                  on
                    ? setEditing(row)
                    : remove.mutate({ path: { chainId: row.id } })
                }
                aria-label="Accept payments"
              />
            ),
          },
          {
            header: "",
            className: "w-12 text-right",
            cell: (row) =>
              addressOf(row.id) ? (
                <RowActions
                  actions={[
                    {
                      label: "Change address",
                      icon: <IconPencil className="size-4" />,
                      onSelect: () => setEditing(row),
                    },
                  ]}
                />
              ) : null,
          },
        ]}
      />

      <Dialog
        open={editing !== null}
        onOpenChange={(open) => !open && setEditing(null)}
        title={editing ? `Payments on ${editing.name}` : "Payments"}
      >
        {editing && (
          <AddressForm
            chain={editing}
            address={addressOf(editing.id)}
            onClose={() => setEditing(null)}
          />
        )}
      </Dialog>
    </>
  );
};
