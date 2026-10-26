import {
  IconAppWindow,
  IconEye,
  IconPencil,
  IconPlus,
  IconTrash,
} from "@tabler/icons-react";
import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import {
  appsDeleteMutation,
  appsListOptions,
  appsUpdateMutation,
  appsCreateMutation,
} from "@/api/@tanstack/react-query.gen";
import type { App } from "@/api/types.gen";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { DataTable } from "@/components/data-table";
import { Field } from "@/components/field";
import { PageHeader } from "@/components/page-header";
import { RowActions } from "@/components/row-actions";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { formatDate } from "@/lib/format";
import { useMutate } from "@/lib/queries";
import SmartImage from "@/components/smart-image";
import None from "@/components/none";

const AppForm = ({ app, onClose }: { app?: App; onClose: () => void }) => {
  const [values, setValues] = useState({
    name: app?.name ?? "",
    icon: app?.icon ?? "",
    websiteUrl: app?.websiteUrl ?? "",
    termsOfServiceUrl: app?.termsOfServiceUrl ?? "",
    privacyPolicyUrl: app?.privacyPolicyUrl ?? "",
    settlementAddress: app?.settlementAddress ?? "",
  });

  const create = useMutate(appsCreateMutation(), {
    success: "App created",
    onSuccess: onClose,
  });

  const update = useMutate(appsUpdateMutation(), {
    success: "App updated",
    onSuccess: onClose,
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const nullable = (value: string) => value.trim() || null;

    const body = {
      name: values.name.trim(),
      icon: nullable(values.icon),
      websiteUrl: nullable(values.websiteUrl),
      termsOfServiceUrl: nullable(values.termsOfServiceUrl),
      privacyPolicyUrl: nullable(values.privacyPolicyUrl),
      settlementAddress: nullable(values.settlementAddress),
    };

    if (app) update.mutate({ body, headers: { "x-kite-app-id": app.id } });
    else create.mutate({ body });
  };

  const set =
    (key: keyof typeof values) => (event: { target: { value: string } }) =>
      setValues({ ...values, [key]: event.target.value });

  return (
    <form className="space-y-4" onSubmit={submit}>
      <Field label="Name">
        <Input required value={values.name} onChange={set("name")} />
      </Field>
      <Field label="Icon URL">
        <Input type="url" value={values.icon} onChange={set("icon")} />
      </Field>
      <Field label="Website">
        <Input
          type="url"
          value={values.websiteUrl}
          onChange={set("websiteUrl")}
        />
      </Field>
      <Field label="Terms of service URL">
        <Input
          type="url"
          value={values.termsOfServiceUrl}
          onChange={set("termsOfServiceUrl")}
        />
      </Field>
      <Field label="Privacy policy URL">
        <Input
          type="url"
          value={values.privacyPolicyUrl}
          onChange={set("privacyPolicyUrl")}
        />
      </Field>
      <Field
        label="Settlement address (optional)"
        hint="Where settled funds go. Leave empty to use the operator wallet."
      >
        <Input
          value={values.settlementAddress}
          onChange={set("settlementAddress")}
        />
      </Field>
      <div className="flex justify-end gap-2 pt-2">
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button
          type="submit"
          disabled={create.isPending || update.isPending || !values.name.trim()}
        >
          {app ? "Save" : "Create app"}
        </Button>
      </div>
    </form>
  );
};

export const Apps = () => {
  const navigate = useNavigate();
  const [editing, setEditing] = useState<App | "new" | null>(null);
  const [deleting, setDeleting] = useState<App | null>(null);

  const remove = useMutate(appsDeleteMutation(), {
    success: "App deleted",
    onSuccess: () => setDeleting(null),
  });

  return (
    <>
      <PageHeader title="Apps" />

      <DataTable
        exportName="apps"
        options={(query) => appsListOptions({ query })}
        rowKey={(row) => row.id}
        searchPlaceholder="Search apps"
        empty={{
          icon: IconAppWindow,
          title: "No apps yet",
          description:
            "Create an app for each product or business taking payments.",
        }}
        toolbar={
          <Button onClick={() => setEditing("new")}>
            <IconPlus className="size-4" />
            New app
          </Button>
        }
        onRowClick={(row) => navigate(`/apps/${row.id}`)}
        columns={[
          {
            header: "App",
            cell: (row) => (
              <div className="flex items-center gap-3 w-max">
                <SmartImage url={row.icon} />
                <span className="font-medium">{row.name}</span>
              </div>
            ),
          },
          { header: "Website", cell: (row) => row.websiteUrl ?? <None /> },
          { header: "Created", cell: (row) => formatDate(row.createdAt) },
          {
            header: "",
            className: "w-12 text-right",
            cell: (row) => (
              <div onClick={(event) => event.stopPropagation()}>
                <RowActions
                  actions={[
                    {
                      label: "View app",
                      icon: <IconEye className="size-4" />,
                      onSelect: () => navigate(`/apps/${row.id}`),
                    },
                    {
                      label: "Edit",
                      icon: <IconPencil className="size-4" />,
                      onSelect: () => setEditing(row),
                    },
                    {
                      label: "Delete",
                      icon: <IconTrash className="size-4" />,
                      danger: true,
                      onSelect: () => setDeleting(row),
                    },
                  ]}
                />
              </div>
            ),
          },
        ]}
      />

      <Dialog
        open={editing !== null}
        onOpenChange={(open) => !open && setEditing(null)}
        title={editing === "new" ? "New app" : "Edit app"}
      >
        {editing !== null && (
          <AppForm
            app={editing === "new" ? undefined : editing}
            onClose={() => setEditing(null)}
          />
        )}
      </Dialog>

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title="Delete app"
        description={`${deleting?.name} will stop working. Its API keys are rejected from now on.`}
        confirmLabel="Delete app"
        pending={remove.isPending}
        onConfirm={() =>
          deleting &&
          remove.mutate({ headers: { "x-kite-app-id": deleting.id } })
        }
      />
    </>
  );
};
