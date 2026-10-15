import { useQuery } from "@tanstack/react-query";
import {
  IconBlocks,
  IconPlus,
  IconSettings,
  IconTrash,
} from "@tabler/icons-react";
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
import { useMutate } from "@/lib/queries";
import None from "@/components/none";

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
      <PageHeader title="Chains" />

      <SimpleTable
        exportName="chains"
        rows={chains.data}
        loading={chains.isLoading}
        error={chains.error}
        rowKey={(row) => row.id}
        searchPlaceholder="Search chains"
        searchText={(row) =>
          `${chainName(row.caip2Id, supported.data)} ${row.caip2Id}`
        }
        empty={{
          icon: IconBlocks,
          title: "No chains yet",
          description:
            "Add a network payments can settle on, then configure it.",
        }}
        toolbar={
          <Button
            onClick={() => {
              setSelected(available?.[0]?.caip2Id ?? "");
              setAdding(true);
            }}
          >
            <IconPlus className="size-4" />
            Add chain
          </Button>
        }
        columns={[
          {
            header: "Chain",
            cell: (row) => (
              <p className="font-medium">
                {chainName(row.caip2Id, supported.data)}
              </p>
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
            cell: (row) => row.config?.settlementToken.symbol ?? <None />,
          },
          {
            header: "Active",
            exportValue: (row) => (row.isActive ? "Yes" : "No"),
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
                    icon: <IconSettings className="size-4" />,
                    onSelect: () => navigate(`/chains/${row.id}`),
                  },
                  {
                    label: "Remove",
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

      <Dialog open={adding} onOpenChange={setAdding} title="Add chain">
        <div className="space-y-4">
          <Field label="Network">
            <Select
              value={selected}
              onChange={(event) => setSelected(event.target.value)}
            >
              {available?.map((chain) => (
                <option key={chain.caip2Id} value={chain.caip2Id}>
                  {chain.name}
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
