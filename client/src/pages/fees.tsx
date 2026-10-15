import { useQuery } from "@tanstack/react-query";
import {
  IconDiscount2,
  IconPencil,
  IconPlus,
  IconTrash,
} from "@tabler/icons-react";
import { useState, type FormEvent } from "react";
import {
  deleteApiFeesByIdMutation,
  getApiChainsFullOptions,
  getApiFeesOptions,
  patchApiFeesByIdMutation,
  postApiFeesMutation,
} from "@/api/@tanstack/react-query.gen";
import type {
  ChainWithConfig,
  FeeWithChain,
  PostApiFeesData,
} from "@/api/types.gen";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { DataTable } from "@/components/data-table";
import { Field } from "@/components/field";
import { PageHeader } from "@/components/page-header";
import { RowActions } from "@/components/row-actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input, Select, Textarea } from "@/components/ui/input";
import { shortAddress } from "@/lib/format";
import { useAppHeaders, useAppScope, useMutate } from "@/lib/queries";
import { chainName, useSupportedChains } from "./chains";

type Condition = PostApiFeesData["body"]["condition"];

const FeeForm = ({
  fee,
  chains,
  onClose,
}: {
  fee?: FeeWithChain;
  chains: ChainWithConfig[];
  onClose: () => void;
}) => {
  const headers = useAppHeaders();
  const supported = useSupportedChains();
  const [values, setValues] = useState({
    chainId: fee?.chainId ?? chains[0]?.id ?? "",
    label: fee?.label ?? "",
    type: fee?.type ?? "Variable",
    value: fee?.value ?? "",
    minAmountToCharge: fee?.minAmountToCharge ?? "",
    maxAmountToCharge: fee?.maxAmountToCharge ?? "",
    feeAddress: fee?.feeAddress ?? "",
    condition: JSON.stringify(fee?.condition ?? {}, null, 2),
  });
  const [conditionError, setConditionError] = useState<string | null>(null);

  const create = useMutate(postApiFeesMutation({ headers }), {
    success: "Fee created",
    onSuccess: onClose,
  });

  const update = useMutate(patchApiFeesByIdMutation({ headers }), {
    success: "Fee updated",
    onSuccess: onClose,
  });

  const set =
    (key: keyof typeof values) => (event: { target: { value: string } }) =>
      setValues({ ...values, [key]: event.target.value });

  const submit = (event: FormEvent) => {
    event.preventDefault();

    let condition: Condition;
    try {
      condition = JSON.parse(values.condition || "{}");
    } catch {
      return setConditionError("The condition must be valid JSON");
    }
    setConditionError(null);

    const body = {
      label: values.label.trim(),
      type: values.type,
      value: values.value.trim(),
      minAmountToCharge: values.minAmountToCharge.trim() || null,
      maxAmountToCharge: values.maxAmountToCharge.trim() || null,
      feeAddress: values.feeAddress.trim() || null,
      condition,
    };

    if (fee) update.mutate({ path: { id: fee.id }, body });
    else create.mutate({ body: { ...body, chainId: values.chainId } });
  };

  return (
    <form className="space-y-4" onSubmit={submit}>
      {!fee && (
        <Field label="Chain">
          <Select required value={values.chainId} onChange={set("chainId")}>
            {chains.map((chain) => (
              <option key={chain.id} value={chain.id}>
                {chainName(chain.caip2Id, supported.data)}
              </option>
            ))}
          </Select>
        </Field>
      )}
      <Field label="Label">
        <Input required value={values.label} onChange={set("label")} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Type">
          <Select value={values.type} onChange={set("type")}>
            <option value="Variable">Variable (basis points)</option>
            <option value="Fixed">Fixed (token base units)</option>
          </Select>
        </Field>
        <Field
          label={values.type === "Variable" ? "Basis points" : "Amount"}
          hint={
            values.type === "Variable"
              ? "100 = 1%"
              : "In the settlement token's smallest unit"
          }
        >
          <Input
            required
            inputMode="numeric"
            value={values.value}
            onChange={set("value")}
          />
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Minimum charge">
          <Input
            inputMode="numeric"
            value={values.minAmountToCharge}
            onChange={set("minAmountToCharge")}
          />
        </Field>
        <Field label="Maximum charge">
          <Input
            inputMode="numeric"
            value={values.maxAmountToCharge}
            onChange={set("maxAmountToCharge")}
          />
        </Field>
      </div>
      <Field
        label="Fee address"
        hint="Optional. Defaults to the settlement address."
      >
        <Input
          className="font-mono"
          value={values.feeAddress}
          onChange={set("feeAddress")}
          placeholder="0x…"
        />
      </Field>
      <Field
        label="Condition"
        hint='JSON. Keys: customer, sourceCurrency, targetCurrency, sourceAmount. Example: { "sourceAmount": { "_gte": "1000000" } }'
      >
        <Textarea
          className="min-h-28"
          value={values.condition}
          onChange={set("condition")}
        />
        {conditionError && (
          <p className="text-xs text-danger">{conditionError}</p>
        )}
      </Field>
      <div className="flex justify-end gap-2 pt-2">
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" disabled={create.isPending || update.isPending}>
          {fee ? "Save" : "Create fee"}
        </Button>
      </div>
    </form>
  );
};

export const Fees = () => {
  const { appId } = useAppScope();
  const headers = useAppHeaders();
  const chains = useQuery(getApiChainsFullOptions());
  const supported = useSupportedChains();
  const [editing, setEditing] = useState<FeeWithChain | "new" | null>(null);
  const [deleting, setDeleting] = useState<FeeWithChain | null>(null);

  const remove = useMutate(deleteApiFeesByIdMutation({ headers }), {
    success: "Fee deleted",
    onSuccess: () => setDeleting(null),
  });

  return (
    <>
      <PageHeader
        title="Fees"
        description={
          appId
            ? "Fees charged on this app's payments, plus the system-wide fees that also apply."
            : "System-wide fees. They apply to every app."
        }
      />

      <DataTable
        exportName="fees"
        options={(query) => getApiFeesOptions({ query, headers })}
        rowKey={(row) => row.id}
        searchPlaceholder="Search fees"
        empty={{
          icon: IconDiscount2,
          title: "No fees yet",
          description: "Add a fixed or percentage fee to take from payments.",
        }}
        toolbar={
          <Button
            disabled={!chains.data?.length}
            onClick={() => setEditing("new")}
          >
            <IconPlus className="size-4" />
            New fee
          </Button>
        }
        columns={[
          {
            header: "Fee",
            cell: (row) => (
              <div>
                <p className="font-medium">{row.label}</p>
                <p className="text-xs text-muted">
                  {chainName(row.chain.caip2Id, supported.data)}
                </p>
              </div>
            ),
          },
          {
            header: "Charge",
            cell: (row) =>
              row.type === "Variable"
                ? `${Number(row.value) / 100}%`
                : `${row.value} base units`,
          },
          {
            header: "Limits",
            cell: (row) =>
              row.minAmountToCharge || row.maxAmountToCharge
                ? `${row.minAmountToCharge ?? "0"} – ${row.maxAmountToCharge ?? "∞"}`
                : "—",
          },
          {
            header: "Applies to",
            cell: (row) =>
              Object.keys(row.condition).length === 0 ? (
                <span className="text-muted">Every payment</span>
              ) : (
                <code className="text-xs">
                  {Object.keys(row.condition).join(", ")}
                </code>
              ),
          },
          {
            header: "Recipient",
            exportValue: (row) => row.feeAddress ?? "Default",
            cell: (row) =>
              row.feeAddress ? (
                <span className="font-mono text-xs">
                  {shortAddress(row.feeAddress)}
                </span>
              ) : (
                <span className="text-muted">Default</span>
              ),
          },
          {
            header: "Scope",
            cell: (row) =>
              row.appId ? (
                <Badge variant="neutral">App</Badge>
              ) : (
                <Badge variant="pending">System</Badge>
              ),
          },
          {
            header: "",
            className: "w-12 text-right",
            cell: (row) => (
              <RowActions
                actions={[
                  {
                    label: "Edit",
                    icon: <IconPencil className="size-4" />,
                    hidden: !!appId && !row.appId,
                    onSelect: () => setEditing(row),
                  },
                  {
                    label: "Delete",
                    icon: <IconTrash className="size-4" />,
                    danger: true,
                    hidden: !!appId && !row.appId,
                    onSelect: () => setDeleting(row),
                  },
                ]}
              />
            ),
          },
        ]}
      />

      <Dialog
        open={editing !== null}
        onOpenChange={(open) => !open && setEditing(null)}
        title={editing === "new" ? "New fee" : "Edit fee"}
      >
        {editing !== null && (
          <FeeForm
            fee={editing === "new" ? undefined : editing}
            chains={chains.data ?? []}
            onClose={() => setEditing(null)}
          />
        )}
      </Dialog>

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title="Delete fee"
        description={`${deleting?.label} will no longer be charged on new quotes.`}
        confirmLabel="Delete fee"
        pending={remove.isPending}
        onConfirm={() =>
          deleting && remove.mutate({ path: { id: deleting.id } })
        }
      />
    </>
  );
};
