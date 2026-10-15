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
  getApiTokensOptions,
  patchApiFeesByIdMutation,
  postApiFeesMutation,
} from "@/api/@tanstack/react-query.gen";
import type { ChainWithConfig, FeeWithChain } from "@/api/types.gen";
import {
  ConditionBuilder,
  fromRules,
  toRules,
  type Condition,
} from "@/components/condition-builder";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { DataTable } from "@/components/data-table";
import { Field } from "@/components/field";
import { PageHeader } from "@/components/page-header";
import { RowActions } from "@/components/row-actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input, Select, Textarea } from "@/components/ui/input";
import { formatDate, shortAddress } from "@/lib/format";
import { useAppHeaders, useAppScope, useMutate } from "@/lib/queries";
import { chainName, useSupportedChains } from "./chains";
import { CopyButton } from "@/components/copy-button";

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
  // Null when the stored condition can't be shown in the builder.
  const [rules, setRules] = useState(() => toRules(fee?.condition ?? {}));
  const [conditionError, setConditionError] = useState<string | null>(null);

  const tokens = useQuery(
    getApiTokensOptions({
      query: { chainId: values.chainId, pageSize: 100 },
    }),
  );

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
    if (rules) {
      const result = fromRules(rules);
      if ("error" in result) return setConditionError(result.error);
      condition = result.condition;
    } else {
      try {
        condition = JSON.parse(values.condition || "{}");
      } catch {
        return setConditionError("The condition must be valid JSON");
      }
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
            <option value="Variable">Variable</option>
            <option value="Fixed">Fixed</option>
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
        <Field label="Min. charge (optional)">
          <Input
            inputMode="numeric"
            value={values.minAmountToCharge}
            onChange={set("minAmountToCharge")}
          />
        </Field>
        <Field label="Max. charge (optional)">
          <Input
            inputMode="numeric"
            value={values.maxAmountToCharge}
            onChange={set("maxAmountToCharge")}
          />
        </Field>
      </div>
      <Field
        label="Fee address (optional)"
        hint="Defaults to the settlement address."
      >
        <Input value={values.feeAddress} onChange={set("feeAddress")} />
      </Field>
      <Field
        label="Conditions (optional)"
        hint={
          rules
            ? "The fee is charged on payments that match every condition, or on every payment when there are none."
            : 'This condition uses options the builder can\'t show, so it is edited as JSON. Keys: customer, sourceCurrency, targetCurrency, sourceAmount. Example: { "sourceAmount": { "_gte": "1000000" } }'
        }
      >
        {rules ? (
          <ConditionBuilder
            rules={rules}
            tokens={tokens.data?.data ?? []}
            onChange={setRules}
          />
        ) : (
          <Textarea
            className="min-h-28"
            value={values.condition}
            onChange={set("condition")}
          />
        )}
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
      <PageHeader title="Fees" />

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
            header: "Label",
            cell: (row) => <p className="font-medium">{row.label}</p>,
          },
          {
            header: "Chain",
            cell: (row) => (
              <p>{chainName(row.chain.caip2Id, supported.data)}</p>
            ),
          },
          {
            header: "Charge",
            cell: (row) =>
              row.type === "Variable" ? (
                `${Number(row.value) / 100}%`
              ) : (
                <p>
                  {row.value}
                  USDC
                </p>
              ),
          },
          {
            header: "Recipient",
            exportValue: (row) => row.feeAddress ?? "Default",
            cell: (row) =>
              row.feeAddress ? (
                <div className="flex items-center">
                  <span>{shortAddress(row.feeAddress)}</span>
                  <CopyButton value={row.feeAddress} />
                </div>
              ) : (
                <span className="text-muted">Default</span>
              ),
          },
          {
            header: "Scope",
            cell: (row) =>
              row.appId ? (
                <Badge variant="success">App</Badge>
              ) : (
                <Badge variant="pending">System</Badge>
              ),
          },
          { header: "Created", cell: (row) => formatDate(row.createdAt) },
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
