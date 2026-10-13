import { useQuery } from "@tanstack/react-query";
import { Plus, Settings, Trash2 } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  deleteApiChainsByIdMutation,
  getApiChainsFullOptions,
  getApiChainsSupportedOptions,
  patchApiChainsByIdMutation,
  postApiChainsMutation,
} from "@/api/@tanstack/react-query.gen";
import type { ChainWithConfig, SupportedChain } from "@/api/types.gen";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Field } from "@/components/field";
import { PageHeader } from "@/components/page-header";
import { RowActions } from "@/components/row-actions";
import { SimpleTable } from "@/components/simple-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Select } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { shortAddress } from "@/lib/format";
import { useMutate } from "@/lib/queries";

export const useSupportedChains = () =>
  useQuery(getApiChainsSupportedOptions());

export const chainName = (caip2Id: string, supported?: SupportedChain[]) =>
  supported?.find((chain) => chain.caip2Id === caip2Id)?.name ?? caip2Id;

export const Chains = () => {
  const navigate = useNavigate();
  const chains = useQuery(getApiChainsFullOptions());
  const supported = useSupportedChains();
  const [adding, setAdding] = useState(false);
  const [selected, setSelected] = useState("");
  const [deleting, setDeleting] = useState<ChainWithConfig | null>(null);

  const create = useMutate(postApiChainsMutation(), {
    success: "Chain added",
    onSuccess: (chain) => {
      setAdding(false);
      navigate(`/chains/${chain.id}`);
    },
  });

  const toggle = useMutate(patchApiChainsByIdMutation());

  const remove = useMutate(deleteApiChainsByIdMutation(), {
    success: "Chain removed",
    onSuccess: () => setDeleting(null),
  });

  const taken = new Set(chains.data?.map((chain) => chain.caip2Id));
  const available = supported.data?.filter(
    (chain) => !taken.has(chain.caip2Id),
  );

  return (
    <>
      <PageHeader
        title="Chains"
        description="Networks payments can settle on. Add a chain, then configure it."
      />

      <SimpleTable
        rows={chains.data}
        loading={chains.isLoading}
        error={chains.error}
        rowKey={(row) => row.id}
        searchPlaceholder="Search chains"
        searchText={(row) =>
          `${chainName(row.caip2Id, supported.data)} ${row.caip2Id}`
        }
        empty="No chains yet. Add the first one."
        toolbar={
          <Button
            onClick={() => {
              setSelected(available?.[0]?.caip2Id ?? "");
              setAdding(true);
            }}
          >
            <Plus className="size-4" />
            Add chain
          </Button>
        }
        columns={[
          {
            header: "Chain",
            cell: (row) => (
              <button
                type="button"
                className="text-left"
                onClick={() => navigate(`/chains/${row.id}`)}
              >
                <p className="font-medium">
                  {chainName(row.caip2Id, supported.data)}
                </p>
                <p className="text-xs text-muted">{row.caip2Id}</p>
              </button>
            ),
          },
          {
            header: "Status",
            cell: (row) =>
              row.config ? (
                <Badge variant="success">Configured</Badge>
              ) : (
                <Badge variant="warning">Needs configuration</Badge>
              ),
          },
          {
            header: "Settlement token",
            cell: (row) => row.config?.settlementToken.symbol ?? "—",
          },
          {
            header: "Factory",
            cell: (row) =>
              row.config ? (
                <span className="font-mono text-xs">
                  {shortAddress(row.config.kiteFactoryAddress)}
                </span>
              ) : (
                "—"
              ),
          },
          {
            header: "Active",
            cell: (row) => (
              <Switch
                checked={row.isActive}
                disabled={toggle.isPending}
                onCheckedChange={(isActive) =>
                  toggle.mutate({ path: { id: row.id }, body: { isActive } })
                }
                aria-label="Active"
              />
            ),
          },
          {
            header: "",
            className: "w-12 text-right",
            cell: (row) => (
              <RowActions
                actions={[
                  {
                    label: "Manage",
                    icon: <Settings className="size-4" />,
                    onSelect: () => navigate(`/chains/${row.id}`),
                  },
                  {
                    label: "Remove",
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

      <Dialog open={adding} onOpenChange={setAdding} title="Add chain">
        <div className="space-y-4">
          <Field label="Network">
            <Select
              value={selected}
              onChange={(event) => setSelected(event.target.value)}
            >
              {available?.map((chain) => (
                <option key={chain.caip2Id} value={chain.caip2Id}>
                  {chain.name} ({chain.caip2Id})
                </option>
              ))}
            </Select>
          </Field>
          {available?.length === 0 && (
            <p className="text-sm text-muted">
              Every supported network has been added.
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setAdding(false)}>
              Cancel
            </Button>
            <Button
              disabled={!selected || create.isPending}
              onClick={() => create.mutate({ body: { caip2Id: selected } })}
            >
              Add chain
            </Button>
          </div>
        </div>
      </Dialog>

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title="Remove chain"
        description="New payments on this chain stop immediately. Existing transfers are kept."
        confirmLabel="Remove chain"
        pending={remove.isPending}
        onConfirm={() =>
          deleting && remove.mutate({ path: { id: deleting.id } })
        }
      />
    </>
  );
};
