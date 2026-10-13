import { Pencil, Plus, Trash2 } from "lucide-react";
import { useState, type FormEvent } from "react";
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
import { useAppScope, useGet, useMutate } from "@/lib/queries";
import { chainName, useSupportedChains, type ChainRow } from "./chains";

type Fee = {
  id: string;
  appId: string | null;
  chainId: string;
  label: string;
  type: "Fixed" | "Variable";
  value: string;
  minAmountToCharge: string | null;
  maxAmountToCharge: string | null;
  condition: Record<string, unknown>;
  feeAddress: string | null;
  chain: { caip2Id: string };
};

const FeeForm = ({
  fee,
  chains,
  onClose,
}: {
  fee?: Fee;
  chains: ChainRow[];
  onClose: () => void;
}) => {
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

  const save = useMutate<Record<string, unknown>>(
    fee ? "PATCH" : "POST",
    fee ? `/api/fees/${fee.id}` : "/api/fees",
    { success: fee ? "Fee updated" : "Fee created", onSuccess: onClose },
  );

  const set =
    (key: keyof typeof values) => (event: { target: { value: string } }) =>
      setValues({ ...values, [key]: event.target.value });

  const submit = (event: FormEvent) => {
    event.preventDefault();

    let condition: unknown;
    try {
      condition = JSON.parse(values.condition || "{}");
    } catch {
      return setConditionError("The condition must be valid JSON");
    }
    setConditionError(null);

    save.mutate({
      ...(fee ? {} : { chainId: values.chainId }),
      label: values.label.trim(),
      type: values.type,
      value: values.value.trim(),
      minAmountToCharge: values.minAmountToCharge.trim() || null,
      maxAmountToCharge: values.maxAmountToCharge.trim() || null,
      feeAddress: values.feeAddress.trim() || null,
      condition,
    });
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
        <Button type="submit" disabled={save.isPending}>
          {fee ? "Save" : "Create fee"}
        </Button>
      </div>
    </form>
  );
};

export const Fees = () => {
  const { appId } = useAppScope();
  const chains = useGet<ChainRow[]>("/api/admin/chains");
  const supported = useSupportedChains();
  const [editing, setEditing] = useState<Fee | "new" | null>(null);
  const [deleting, setDeleting] = useState<Fee | null>(null);

  const remove = useMutate<string>("DELETE", (id) => `/api/fees/${id}`, {
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

      <DataTable<Fee>
        path="/api/fees"
        rowKey={(row) => row.id}
        searchPlaceholder="Search fees"
        empty="No fees yet"
        toolbar={
          <Button
            disabled={!chains.data?.length}
            onClick={() => setEditing("new")}
          >
            <Plus className="size-4" />
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
                    icon: <Pencil className="size-4" />,
                    hidden: !!appId && !row.appId,
                    onSelect: () => setEditing(row),
                  },
                  {
                    label: "Delete",
                    icon: <Trash2 className="size-4" />,
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
        onConfirm={() => deleting && remove.mutate(deleting.id)}
      />
    </>
  );
};
