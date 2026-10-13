import { useQuery } from "@tanstack/react-query";
import { getApiKvOptions } from "@/api/@tanstack/react-query.gen";
import { PageHeader } from "@/components/page-header";
import { SimpleTable } from "@/components/simple-table";
import { Badge } from "@/components/ui/badge";
import { formatDateTime } from "@/lib/format";

export const Kv = () => {
  const rows = useQuery(getApiKvOptions());

  return (
    <>
      <PageHeader
        title="KV"
        description="Provider credentials and identifiers the server needs. Secrets are encrypted and never shown."
      />

      <SimpleTable
        exportName="kv"
        rows={rows.data}
        loading={rows.isLoading}
        error={rows.error}
        rowKey={(row) => row.key}
        searchPlaceholder="Search keys"
        searchText={(row) => row.key}
        columns={[
          {
            header: "Key",
            cell: (row) => <span className="font-medium">{row.key}</span>,
          },
          {
            header: "Type",
            cell: (row) => (
              <Badge
                variant={row.type === "SecureString" ? "pending" : "neutral"}
              >
                {row.type === "SecureString" ? "Secret" : "Text"}
              </Badge>
            ),
          },
          {
            header: "Value",
            cell: (row) =>
              row.value === null ? (
                <Badge variant="warning">Not set</Badge>
              ) : row.type === "SecureString" ? (
                <span className="tracking-widest text-muted">••••••••</span>
              ) : (
                <span className="font-mono text-xs">{row.value}</span>
              ),
          },
          {
            header: "Updated",
            cell: (row) => formatDateTime(row.updatedAt),
          },
        ]}
      />
    </>
  );
};
