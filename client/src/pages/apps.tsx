import { Eye, Pencil, Plus, Trash2 } from "lucide-react";
import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { DataTable } from "@/components/data-table";
import { Field } from "@/components/field";
import { PageHeader } from "@/components/page-header";
import { RowActions } from "@/components/row-actions";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { formatDate, initials } from "@/lib/format";
import { useMutate } from "@/lib/queries";

type AppRow = {
  id: string;
  name: string;
  icon: string | null;
  websiteUrl: string | null;
  termsOfServiceUrl: string | null;
  privacyPolicyUrl: string | null;
  createdAt: string;
};

const AppForm = ({ app, onClose }: { app?: AppRow; onClose: () => void }) => {
  const [values, setValues] = useState({
    name: app?.name ?? "",
    icon: app?.icon ?? "",
    websiteUrl: app?.websiteUrl ?? "",
    termsOfServiceUrl: app?.termsOfServiceUrl ?? "",
    privacyPolicyUrl: app?.privacyPolicyUrl ?? "",
  });

  const save = useMutate<Record<string, string | null>, AppRow>(
    app ? "PATCH" : "POST",
    app ? `/api/admin/apps/${app.id}` : "/api/admin/apps",
    { success: app ? "App updated" : "App created", onSuccess: onClose },
  );

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const nullable = (value: string) => value.trim() || null;

    save.mutate({
      name: values.name.trim(),
      icon: nullable(values.icon),
      websiteUrl: nullable(values.websiteUrl),
      termsOfServiceUrl: nullable(values.termsOfServiceUrl),
      privacyPolicyUrl: nullable(values.privacyPolicyUrl),
    });
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
      <div className="flex justify-end gap-2 pt-2">
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" disabled={save.isPending || !values.name.trim()}>
          {app ? "Save" : "Create app"}
        </Button>
      </div>
    </form>
  );
};

export const Apps = () => {
  const navigate = useNavigate();
  const [editing, setEditing] = useState<AppRow | "new" | null>(null);
  const [deleting, setDeleting] = useState<AppRow | null>(null);

  const remove = useMutate<string>("DELETE", (id) => `/api/admin/apps/${id}`, {
    success: "App deleted",
    onSuccess: () => setDeleting(null),
  });

  return (
    <>
      <PageHeader
        title="Apps"
        description="Every app integrating with this server. Open one to manage it as root."
      />

      <DataTable<AppRow>
        path="/api/admin/apps"
        rowKey={(row) => row.id}
        searchPlaceholder="Search apps"
        empty="No apps yet. Create the first one."
        toolbar={
          <Button onClick={() => setEditing("new")}>
            <Plus className="size-4" />
            New app
          </Button>
        }
        onRowClick={(row) => navigate(`/apps/${row.id}`)}
        columns={[
          {
            header: "App",
            cell: (row) => (
              <div className="flex items-center gap-3">
                {row.icon ? (
                  <img
                    src={row.icon}
                    alt=""
                    className="size-9 rounded-full object-cover"
                  />
                ) : (
                  <span className="flex size-9 items-center justify-center rounded-full bg-soft text-xs font-semibold">
                    {initials(row.name)}
                  </span>
                )}
                <span className="font-medium">{row.name}</span>
              </div>
            ),
          },
          { header: "Website", cell: (row) => row.websiteUrl ?? "—" },
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
                      icon: <Eye className="size-4" />,
                      onSelect: () => navigate(`/apps/${row.id}`),
                    },
                    {
                      label: "Edit",
                      icon: <Pencil className="size-4" />,
                      onSelect: () => setEditing(row),
                    },
                    {
                      label: "Delete",
                      icon: <Trash2 className="size-4" />,
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
        onConfirm={() => deleting && remove.mutate(deleting.id)}
      />
    </>
  );
};
