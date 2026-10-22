import { useQuery } from "@tanstack/react-query";
import { IconBlocks, IconCoins, IconTrash } from "@tabler/icons-react";
import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  chainsDeleteMutation,
  tokensDeleteMutation,
  chainsListFullOptions,
  kvListProvidersOptions,
  tokensListOptions,
  chainsConfigureMutation,
} from "@/api/@tanstack/react-query.gen";
import { tokensGetByAddress } from "@/api/sdk.gen";
import type {
  ChainConfig,
  ChainWithConfig,
  ProviderStatus,
  TokenWithChain,
} from "@/api/types.gen";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { EmptyState } from "@/components/empty-state";
import { CopyButton } from "@/components/copy-button";
import { CheckboxGroup, Field, type CheckboxOption } from "@/components/field";
import { PageHeader } from "@/components/page-header";
import { RowActions } from "@/components/row-actions";
import { SimpleTable } from "@/components/simple-table";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input, Select, Textarea } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { shortAddress } from "@/lib/format";
import { useMutate } from "@/lib/queries";
import { cn } from "@/lib/utils";
import { chainName, useSupportedChains } from "./chains";
import SmartImage from "@/components/smart-image";

type Provider = ChainConfig["gasSponsorProviders"][number];

// The providers able to act as `action`; those without their keys set can't
// be picked until they are added in Providers.
const providerOptions = (
  statuses: ProviderStatus[],
  action: ProviderStatus["action"],
): CheckboxOption<Provider>[] =>
  statuses
    .filter((status) => status.action === action)
    .map((status) => ({
      value: status.provider,
      label: status.provider,
      unavailable: status.configured ? undefined : <></>,
    }));

const configuredProviders = (
  statuses: ProviderStatus[],
  action: ProviderStatus["action"],
) =>
  statuses
    .filter((status) => status.action === action && status.configured)
    .map((status) => status.provider);

const ConfigurationForm = ({
  chain,
  tokens,
  providers,
}: {
  chain: ChainWithConfig;
  tokens: TokenWithChain[];
  providers: ProviderStatus[];
}) => {
  const config = chain.config;
  const [values, setValues] = useState({
    rpcUrls: (config?.rpcUrls ?? []).join("\n"),
    slippageBps: String(config?.slippageBps ?? 100),
    kiteFactoryAddress: config?.kiteFactoryAddress ?? "",
    settlementTokenId: config?.settlementTokenId ?? "",
    usdPeggedTokenId: config?.usdPeggedTokenId ?? "",
    settlementAddress: config?.settlementAddress ?? "",
    maxGasPrice: config?.maxGasPrice ?? "",
    // A new configuration starts with every provider that is ready.
    onchainNotifierProviders:
      config?.onchainNotifierProviders ??
      configuredProviders(providers, "OnchainNotifier"),
    gasSponsorProviders:
      config?.gasSponsorProviders ??
      configuredProviders(providers, "GasSponsor"),
  });

  useEffect(() => {
    if (!values.settlementTokenId && tokens[0]) {
      setValues((current) => ({
        ...current,
        settlementTokenId: tokens[0].id,
        usdPeggedTokenId: current.usdPeggedTokenId || tokens[0].id,
      }));
    }
  }, [tokens, values.settlementTokenId]);

  const save = useMutate(chainsConfigureMutation(), {
    success: "Configuration saved",
  });

  const set =
    (key: keyof typeof values) => (event: { target: { value: string } }) =>
      setValues({ ...values, [key]: event.target.value });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const urls = values.rpcUrls
      .split("\n")
      .map((url) => url.trim())
      .filter(Boolean);

    save.mutate({
      path: { id: chain.id },
      body: {
        rpcUrls: urls.length ? urls : null,
        slippageBps: Number(values.slippageBps),
        kiteFactoryAddress: values.kiteFactoryAddress.trim(),
        settlementTokenId: values.settlementTokenId,
        usdPeggedTokenId: values.usdPeggedTokenId,
        settlementAddress: values.settlementAddress.trim() || null,
        maxGasPrice: values.maxGasPrice.trim() || null,
        onchainNotifierProviders: values.onchainNotifierProviders,
        gasSponsorProviders: values.gasSponsorProviders,
      },
    });
  };

  const tokenOptions = tokens.map((token) => (
    <option key={token.id} value={token.id}>
      {token.symbol}
    </option>
  ));

  return (
    <Card className="max-w-2xl p-6">
      <form className="space-y-5" onSubmit={submit}>
        <Field label="KiteFactory address">
          <Input
            required
            value={values.kiteFactoryAddress}
            onChange={set("kiteFactoryAddress")}
          />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Settlement token"
            hint="What payments are settled in. Add tokens in the Tokens tab first."
          >
            <Select
              required
              value={values.settlementTokenId}
              onChange={set("settlementTokenId")}
            >
              <option value="" disabled>
                Select a token
              </option>
              {tokenOptions}
            </Select>
          </Field>
          <Field label="USD-pegged token" hint="Used to value payments in USD.">
            <Select
              required
              value={values.usdPeggedTokenId}
              onChange={set("usdPeggedTokenId")}
            >
              <option value="" disabled>
                Select a token
              </option>
              {tokenOptions}
            </Select>
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Slippage (basis points)"
            hint="100 = 1%. Between 0 and 9900."
          >
            <Input
              required
              type="number"
              min={0}
              max={9900}
              value={values.slippageBps}
              onChange={set("slippageBps")}
            />
          </Field>
          <Field label="Max gas price in wei (optional)">
            <Input
              inputMode="numeric"
              value={values.maxGasPrice}
              onChange={set("maxGasPrice")}
            />
          </Field>
        </div>

        <Field
          label="Settlement address (optional)"
          hint="Where settled funds go. Leave empty to use the operator wallet."
        >
          <Input
            value={values.settlementAddress}
            onChange={set("settlementAddress")}
          />
        </Field>

        <Field
          label="RPC URLs"
          hint="One per line. Optional; public RPCs are used as a fallback."
        >
          <Textarea value={values.rpcUrls} onChange={set("rpcUrls")} />
        </Field>

        <Field
          label="Deposit notifier providers"
          hint="Watch pay-in addresses and tell the server when deposits land."
        >
          <CheckboxGroup
            options={providerOptions(providers, "OnchainNotifier")}
            value={values.onchainNotifierProviders}
            onChange={(next) =>
              setValues({ ...values, onchainNotifierProviders: next })
            }
          />
        </Field>

        <Field
          label="Gas sponsor providers"
          hint="Pay gas for the operator's settlement transactions."
        >
          <CheckboxGroup
            options={providerOptions(providers, "GasSponsor")}
            value={values.gasSponsorProviders}
            onChange={(next) =>
              setValues({ ...values, gasSponsorProviders: next })
            }
          />
        </Field>

        <div className="flex justify-end">
          <Button type="submit" disabled={save.isPending}>
            Save changes
          </Button>
        </div>
      </form>
    </Card>
  );
};

const TokensTab = ({
  chainId,
  tokens,
  loading,
}: {
  chainId: string;
  tokens: TokenWithChain[];
  loading: boolean;
}) => {
  const [address, setAddress] = useState("");
  const [deleting, setDeleting] = useState<TokenWithChain | null>(null);

  const add = useMutate(
    {
      mutationFn: async (address: string) => {
        const { data } = await tokensGetByAddress({
          path: { chainId, address },
        });

        return data;
      },
    },
    { success: "Token added", onSuccess: () => setAddress("") },
  );

  const remove = useMutate(tokensDeleteMutation(), {
    success: "Token removed",
    onSuccess: () => setDeleting(null),
  });

  return (
    <div className="space-y-4">
      <Card className="p-4">
        <form
          className="flex flex-col md:flex-row md:items-end gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            add.mutate(address.trim());
          }}
        >
          <div className="flex-1">
            <Field
              label="Add a token by contract address"
              hint="Its name, symbol and decimals are read from the chain."
            >
              <Input
                value={address}
                onChange={(event) => setAddress(event.target.value)}
              />
            </Field>
          </div>
          <Button
            type="submit"
            className="h-9.5 px-5"
            disabled={add.isPending || !address.trim()}
          >
            Add token
          </Button>
        </form>
      </Card>

      <SimpleTable
        exportName="tokens"
        rows={tokens}
        loading={loading}
        rowKey={(row) => row.id}
        searchPlaceholder="Search tokens"
        searchText={(row) => `${row.symbol} ${row.name} ${row.address}`}
        empty={{
          icon: IconCoins,
          title: "No tokens on this chain yet",
          description:
            "Add the tokens customers pay with and settle in, by contract address.",
        }}
        columns={[
          {
            header: "Token",
            cell: (row) => (
              <div className="flex items-center gap-2 w-max">
                <SmartImage url={row.icon} />
                <div>
                  <p className="font-medium text-[13px]">{row.symbol}</p>
                  <p className="text-[10px] text-muted">{row.name}</p>
                </div>
              </div>
            ),
          },
          {
            header: "Address",
            exportValue: (row) => row.address,
            cell: (row) => (
              <span className="flex items-center">
                {shortAddress(row.address)}
                <CopyButton value={row.address} />
              </span>
            ),
          },
          { header: "Decimals", cell: (row) => row.decimals },
          {
            header: "EIP-3009",
            cell: (row) => (row.supportsEIP3009 ? "Yes" : "No"),
          },
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

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title="Remove token"
        description={`${deleting?.symbol} can no longer be selected. Tokens used by a configuration or a payment cannot be removed.`}
        confirmLabel="Remove token"
        pending={remove.isPending}
        onConfirm={() =>
          deleting && remove.mutate({ path: { id: deleting.id } })
        }
      />
    </div>
  );
};

export const ChainDetail = () => {
  const { chainId } = useParams();
  const navigate = useNavigate();
  const [tab, setTab] = useState<"configuration" | "tokens">("configuration");
  const [confirming, setConfirming] = useState(false);

  const chains = useQuery(chainsListFullOptions());
  const providers = useQuery(kvListProvidersOptions());
  const supported = useSupportedChains();
  const tokens = useQuery(
    tokensListOptions({ query: { chainId, pageSize: 100 } }),
  );

  const remove = useMutate(chainsDeleteMutation(), {
    success: "Chain removed",
    onSuccess: () => navigate("/chains"),
  });

  const chain = chains.data?.find((row) => row.id === chainId);
  // Right after a chain is added, the cached list predates it until the
  // refetch lands.
  if (
    chains.isLoading ||
    providers.isLoading ||
    (!chain && chains.isFetching)
  ) {
    return (
      <div aria-busy="true" aria-label="Loading">
        <Skeleton className="mb-4 h-4 w-16 bg-line" />
        <div className="mb-6 space-y-2">
          <Skeleton className="h-6 w-44 bg-line" />
          <Skeleton className="h-3 w-24 bg-line" />
        </div>
        <Skeleton className="mb-6 h-9 w-52 rounded-lg bg-line" />
        <Card className="max-w-2xl space-y-5 p-6">
          {[0, 1, 2, 3].map((field) => (
            <div key={field} className="space-y-2">
              <Skeleton className="h-3 w-28" />
              <Skeleton className="h-9 w-full rounded-lg" />
            </div>
          ))}
        </Card>
      </div>
    );
  }

  if (!chain) {
    return (
      <EmptyState
        icon={IconBlocks}
        title="Chain not found"
        description="It may have been removed."
        action={
          <Link to="/chains" className="text-sm font-medium text-brand">
            Back to chains
          </Link>
        }
      />
    );
  }

  return (
    <>
      <PageHeader
        title={chainName(chain.caip2Id, supported.data)}
        action={
          <Button
            variant="danger"
            className="h-9.25"
            onClick={() => setConfirming(true)}
          >
            <IconTrash className="size-4" />
            Remove
          </Button>
        }
      />

      <div className="mb-6 flex w-fit gap-0.5 rounded-full bg-white p-1">
        {(["configuration", "tokens"] as const).map((item) => (
          <button
            key={item}
            type="button"
            onClick={() => setTab(item)}
            className={cn(
              "rounded-full px-3.5 py-1.5 font-medium capitalize transition-colors text-sm",
              tab === item
                ? "bg-soft text-ink shadow-sm"
                : "text-muted hover:text-ink",
            )}
          >
            {item}
          </button>
        ))}
      </div>

      {tab === "configuration" ? (
        <ConfigurationForm
          key={
            chain.id +
            (chain.config ? "configured" : "new") +
            (tokens.data?.total ?? 0)
          }
          chain={chain}
          tokens={tokens.data?.data ?? []}
          providers={providers.data ?? []}
        />
      ) : (
        <TokensTab
          chainId={chain.id}
          tokens={tokens.data?.data ?? []}
          loading={tokens.isLoading}
        />
      )}

      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title="Remove chain"
        description="New payments on this chain stop immediately. Existing transfers are kept."
        confirmLabel="Remove chain"
        pending={remove.isPending}
        onConfirm={() => remove.mutate({ path: { id: chain.id } })}
      />
    </>
  );
};
