import { useQuery } from "@tanstack/react-query";
import { IconPlus, IconTag, IconTrash } from "@tabler/icons-react";
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
import { formatDate, shortAddress } from "@/lib/format";
import { useMutate } from "@/lib/queries";
import { chainName, useSupportedChains } from "./chains";
import None from "@/components/none";

export const PriceFeeds = () => {
  const feeds = useQuery(getApiPriceFeedsOptions());
  const chains = useQuery(getApiChainsFullOptions());
  const configuredChains = chains.data?.filter((chain) => chain.config) ?? [];
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
      <PageHeader title="Price feeds" />

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
        empty={{
          icon: IconTag,
          title: "No price feeds yet",
          description:
            "Add a Chainlink aggregator to price payment links in currencies other than USD.",
        }}
        toolbar={
          <Button
            disabled={configuredChains.length === 0}
            onClick={() => {
              setChainId(configuredChains[0]?.id ?? "");
              setAdding(true);
            }}
          >
            <IconPlus className="size-4" />
            Add price feed
          </Button>
        }
        columns={[
          {
            header: "Pair",
            cell: (row) => (
              <span className="font-medium">
                {row.baseCurrency}/{row.quoteCurrency}
              </span>
            ),
          },
          {
            header: "Rate",
            exportValue: (row) => row.rate,
            cell: (row) => row.rate ?? <None text="N/A" />,
          },
          {
            header: "Aggregator",
            exportValue: (row) => row.decimals,
            cell: (row) => (
              <span className="flex items-center">
                {shortAddress(row.address)}
                <CopyButton value={row.address} />
              </span>
            ),
          },
          { header: "Added on", cell: (row) => formatDate(row.createdAt) },
          {
            header: "",
            className: "w-12 text-right",
            cell: (row) => (
              <RowActions
                actions={[
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
              {configuredChains.map((chain) => (
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
              value={address}
              onChange={(event) => setAddress(event.target.value)}
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
