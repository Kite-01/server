import { useQuery } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import {
  deleteApiPriceFeedsByIdMutation,
  getApiChainsFullOptions,
  getApiPriceFeedsOptions,
  postApiPriceFeedsMutation,
} from "@/api/@tanstack/react-query.gen";
import type { PriceFeedWithChain } from "@/api/types.gen";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { CopyButton } from "@/components/copy-button";
import { Field } from "@/components/field";
import { PageHeader } from "@/components/page-header";
import { RowActions } from "@/components/row-actions";
import { SimpleTable } from "@/components/simple-table";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input, Select } from "@/components/ui/input";
import { shortAddress } from "@/lib/format";
import { useMutate } from "@/lib/queries";
import { chainName, useSupportedChains } from "./chains";

export const PriceFeeds = () => {
  const feeds = useQuery(getApiPriceFeedsOptions());
  const chains = useQuery(getApiChainsFullOptions());
  const supported = useSupportedChains();
  const [adding, setAdding] = useState(false);
  const [chainId, setChainId] = useState("");
  const [address, setAddress] = useState("");
  const [deleting, setDeleting] = useState<PriceFeedWithChain | null>(null);

  const add = useMutate(postApiPriceFeedsMutation(), {
    success: "Price feed added",
    onSuccess: () => {
      setAdding(false);
      setAddress("");
    },
  });

  const remove = useMutate(deleteApiPriceFeedsByIdMutation(), {
    success: "Price feed removed",
    onSuccess: () => setDeleting(null),
  });

  return (
    <>
      <PageHeader
        title="Price feeds"
        description="Chainlink aggregators used to price payment links in other currencies."
      />

      <SimpleTable
        exportName="price-feeds"
        rows={feeds.data}
        loading={feeds.isLoading}
        error={feeds.error}
        rowKey={(row) => row.id}
        searchPlaceholder="Search price feeds"
        searchText={(row) =>
          `${row.baseCurrency}/${row.quoteCurrency} ${row.address}`
        }
        empty="No price feeds yet"
        toolbar={
          <Button
            disabled={!chains.data?.length}
            onClick={() => {
              setChainId(chains.data?.[0]?.id ?? "");
              setAdding(true);
            }}
          >
            <Plus className="size-4" />
            Add price feed
          </Button>
        }
        columns={[
          {
            header: "Pair",
            cell: (row) => (
              <span className="font-medium">
                {row.baseCurrency} / {row.quoteCurrency}
              </span>
            ),
          },
          {
            header: "Chain",
            cell: (row) => chainName(row.chain.caip2Id, supported.data),
          },
          {
            header: "Aggregator",
            exportValue: (row) => row.address,
            cell: (row) => (
              <span className="flex items-center gap-1 font-mono text-xs">
                {shortAddress(row.address)}
                <CopyButton value={row.address} />
              </span>
            ),
          },
          { header: "Decimals", cell: (row) => row.decimals },
          {
            header: "",
            className: "w-12 text-right",
            cell: (row) => (
              <RowActions
                actions={[
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

      <Dialog open={adding} onOpenChange={setAdding} title="Add price feed">
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            add.mutate({ body: { chainId, address: address.trim() } });
          }}
        >
          <Field label="Chain">
            <Select
              value={chainId}
              onChange={(event) => setChainId(event.target.value)}
            >
              {chains.data?.map((chain) => (
                <option key={chain.id} value={chain.id}>
                  {chainName(chain.caip2Id, supported.data)}
                </option>
              ))}
            </Select>
          </Field>
          <Field
            label="Aggregator address"
            hint="The pair and decimals are read from the contract."
          >
            <Input
              required
              className="font-mono"
              value={address}
              onChange={(event) => setAddress(event.target.value)}
              placeholder="0x…"
            />
          </Field>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setAdding(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={add.isPending || !address.trim()}>
              Add price feed
            </Button>
          </div>
        </form>
      </Dialog>

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title="Remove price feed"
        description={`Payment links priced in ${deleting?.baseCurrency} stop working.`}
        confirmLabel="Remove price feed"
        pending={remove.isPending}
        onConfirm={() =>
          deleting && remove.mutate({ path: { id: deleting.id } })
        }
      />
    </>
  );
};
