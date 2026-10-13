import { ArrowLeft, Plus, Trash2 } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { CopyButton } from "@/components/copy-button";
import { CheckboxGroup, Field } from "@/components/field";
import { PageHeader } from "@/components/page-header";
import { RowActions } from "@/components/row-actions";
import { SimpleTable } from "@/components/simple-table";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input, Select, Textarea } from "@/components/ui/input";
import { shortAddress } from "@/lib/format";
import { useGet, useMutate, type Page } from "@/lib/queries";
import { cn } from "@/lib/utils";
import { chainName, useSupportedChains, type ChainRow } from "./chains";

type Token = {
  id: string;
  address: string;
  symbol: string;
  name: string;
  decimals: number;
  supportsEIP3009: boolean;
};

const notifierProviders = [{ value: "QuickNode", label: "QuickNode" }];
const gasSponsorProviders = [{ value: "Alchemy", label: "Alchemy" }];

const ConfigurationForm = ({
  chain,
  tokens,
}: {
  chain: ChainRow;
  tokens: Token[];
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
    onchainNotifierProviders: config?.onchainNotifierProviders ?? ["QuickNode"],
    gasSponsorProviders: config?.gasSponsorProviders ?? ["Alchemy"],
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

  const save = useMutate<Record<string, unknown>>(
    "PUT",
    `/api/admin/chains/${chain.id}/config`,
    { success: "Configuration saved" },
  );

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
      rpcUrls: urls.length ? urls : null,
      slippageBps: Number(values.slippageBps),
      kiteFactoryAddress: values.kiteFactoryAddress.trim(),
      settlementTokenId: values.settlementTokenId,
      usdPeggedTokenId: values.usdPeggedTokenId,
      settlementAddress: values.settlementAddress.trim() || null,
      maxGasPrice: values.maxGasPrice.trim() || null,
      onchainNotifierProviders: values.onchainNotifierProviders,
      gasSponsorProviders: values.gasSponsorProviders,
    });
  };

  const tokenOptions = tokens.map((token) => (
    <option key={token.id} value={token.id}>
      {token.symbol} — {shortAddress(token.address)}
    </option>
  ));

  return (
    <Card className="max-w-2xl p-6">
      <form className="space-y-5" onSubmit={submit}>
        <Field label="KiteFactory address">
          <Input
            required
            className="font-mono"
            value={values.kiteFactoryAddress}
            onChange={set("kiteFactoryAddress")}
            placeholder="0x…"
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
          <Field label="Max gas price (wei)" hint="Optional.">
            <Input
              inputMode="numeric"
              value={values.maxGasPrice}
              onChange={set("maxGasPrice")}
            />
          </Field>
        </div>

        <Field
          label="Settlement address"
          hint="Where settled funds go. Leave empty to use the operator wallet."
        >
          <Input
            className="font-mono"
            value={values.settlementAddress}
            onChange={set("settlementAddress")}
            placeholder="0x…"
          />
        </Field>

        <Field
          label="RPC URLs"
          hint="One per line. Optional; public RPCs are used as a fallback."
        >
          <Textarea value={values.rpcUrls} onChange={set("rpcUrls")} />
        </Field>

        <Field label="Deposit notifier providers">
          <CheckboxGroup
            options={notifierProviders}
            value={values.onchainNotifierProviders}
            onChange={(next) =>
              setValues({ ...values, onchainNotifierProviders: next })
            }
          />
        </Field>

        <Field label="Gas sponsor providers">
          <CheckboxGroup
            options={gasSponsorProviders}
            value={values.gasSponsorProviders}
            onChange={(next) =>
              setValues({ ...values, gasSponsorProviders: next })
            }
          />
        </Field>

        <div className="flex justify-end">
          <Button type="submit" disabled={save.isPending}>
            Save configuration
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
  tokens: Token[];
  loading: boolean;
}) => {
  const [address, setAddress] = useState("");
  const [deleting, setDeleting] = useState<Token | null>(null);

  const add = useMutate<{ chainId: string; address: string }>(
    "POST",
    "/api/admin/tokens",
    { success: "Token added", onSuccess: () => setAddress("") },
  );

  const remove = useMutate<string>(
    "DELETE",
    (id) => `/api/admin/tokens/${id}`,
    {
      success: "Token removed",
      onSuccess: () => setDeleting(null),
    },
  );

  return (
    <div className="space-y-4">
      <Card className="p-4">
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            add.mutate({ chainId, address: address.trim() });
          }}
        >
          <div className="min-w-64 flex-1">
            <Field
              label="Add a token by contract address"
              hint="Its name, symbol and decimals are read from the chain."
            >
              <Input
                className="font-mono"
                value={address}
                onChange={(event) => setAddress(event.target.value)}
                placeholder="0x…"
              />
            </Field>
          </div>
          <Button type="submit" disabled={add.isPending || !address.trim()}>
            <Plus className="size-4" />
            Add token
          </Button>
        </form>
      </Card>

      <SimpleTable<Token>
        rows={tokens}
        loading={loading}
        rowKey={(row) => row.id}
        searchPlaceholder="Search tokens"
        searchText={(row) => `${row.symbol} ${row.name} ${row.address}`}
        empty="No tokens on this chain yet"
        columns={[
          {
            header: "Token",
            cell: (row) => (
              <div>
                <p className="font-medium">{row.symbol}</p>
                <p className="text-xs text-muted">{row.name}</p>
              </div>
            ),
          },
          {
            header: "Address",
            cell: (row) => (
              <span className="flex items-center gap-1 font-mono text-xs">
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

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title="Remove token"
        description={`${deleting?.symbol} can no longer be selected. Tokens used by a configuration or a payment cannot be removed.`}
        confirmLabel="Remove token"
        pending={remove.isPending}
        onConfirm={() => deleting && remove.mutate(deleting.id)}
      />
    </div>
  );
};

export const ChainDetail = () => {
  const { chainId } = useParams();
  const navigate = useNavigate();
  const [tab, setTab] = useState<"configuration" | "tokens">("configuration");
  const [confirming, setConfirming] = useState(false);

  const chains = useGet<ChainRow[]>("/api/admin/chains");
  const supported = useSupportedChains();
  const tokens = useGet<Page<Token>>("/api/admin/tokens", {
    chainId,
    pageSize: 100,
  });

  const remove = useMutate<string>(
    "DELETE",
    (id) => `/api/admin/chains/${id}`,
    {
      success: "Chain removed",
      onSuccess: () => navigate("/chains"),
    },
  );

  const chain = chains.data?.find((row) => row.id === chainId);
  if (chains.isLoading) return null;
  if (!chain) return <p className="text-sm text-muted">Chain not found.</p>;

  return (
    <>
      <Link
        to="/chains"
        className="mb-3 inline-flex items-center gap-1 text-sm text-muted hover:text-ink"
      >
        <ArrowLeft className="size-4" />
        Chains
      </Link>

      <PageHeader
        title={chainName(chain.caip2Id, supported.data)}
        description={chain.caip2Id}
        action={
          <Button variant="outline" onClick={() => setConfirming(true)}>
            <Trash2 className="size-4" />
            Remove chain
          </Button>
        }
      />

      <div className="mb-6 flex gap-1 rounded-full border border-line p-1 text-sm w-fit">
        {(["configuration", "tokens"] as const).map((item) => (
          <button
            key={item}
            type="button"
            onClick={() => setTab(item)}
            className={cn(
              "rounded-full px-4 py-1.5 font-medium capitalize",
              tab === item ? "bg-ink text-white" : "text-muted hover:text-ink",
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
        onConfirm={() => remove.mutate(chain.id)}
      />
    </>
  );
};
