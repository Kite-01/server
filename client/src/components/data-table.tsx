import { useQuery, type UseQueryOptions } from "@tanstack/react-query";
import { useEffect, useState, type ReactNode } from "react";
import {
  Checkbox,
  ExportBar,
  exportCsv,
  rowClass,
  selectColumnClass,
  useRowSelection,
} from "@/components/table-export";
import { EmptyState, toEmptyState, type Empty } from "@/components/empty-state";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, Td, Th } from "@/components/ui/table";
import {
  IconAlertTriangle,
  IconChevronLeft,
  IconChevronRight,
  IconSearch,
} from "@tabler/icons-react";

export type Column<Row> = {
  header: string;
  cell: (row: Row) => ReactNode;
  // What a CSV export holds for this column; defaults to the cell's text.
  exportValue?: (row: Row) => string | number | boolean | null | undefined;
  className?: string;
};

export const TableSearch = ({
  placeholder,
  value,
  onChange,
}: {
  placeholder: string;
  value: string;
  onChange: (value: string) => void;
}) => (
  <div className="relative w-full max-w-xs">
    <IconSearch className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
    <Input
      className="pl-9"
      placeholder={placeholder}
      value={value}
      onChange={(event) => onChange(event.target.value)}
    />
  </div>
);

const LoadingRows = () => (
  <div className="divide-y divide-line" aria-busy="true" aria-label="Loading">
    {[0, 1, 2].map((row) => (
      <div key={row} className="flex items-center gap-4 px-4 py-4">
        <Skeleton className="h-3 w-1/4" />
        <Skeleton className="h-3 w-1/6" />
        <Skeleton className="ml-auto h-3 w-1/12" />
      </div>
    ))}
  </div>
);

/** What a table shows in place of rows: loading, an error, or why it's empty. */
export const TableState = ({
  loading,
  error,
  searching,
  empty,
  onRetry,
}: {
  loading: boolean;
  error?: Error | null;
  searching: boolean;
  empty: Empty;
  onRetry?: () => void;
}) => {
  if (loading) return <LoadingRows />;

  if (error) {
    return (
      <EmptyState
        icon={IconAlertTriangle}
        title="Couldn't load this"
        description={error.message}
        action={
          onRetry ? (
            <Button variant="outline" size="sm" onClick={onRetry}>
              Try again
            </Button>
          ) : null
        }
      />
    );
  }

  return searching ? (
    <EmptyState
      icon={IconSearch}
      title="No results"
      description="Nothing matches your search. Try another term."
    />
  ) : (
    <EmptyState {...toEmptyState(empty)} />
  );
};

type Page = { data: unknown[]; total: number };

type Row<T extends Page> = T["data"][number];

type PageQuery = { q?: string; page: number; pageSize: number };

type Props<T extends Page> = {
  options: (query: PageQuery) => UseQueryOptions<T, Error, T, any>;
  columns: Column<Row<T>>[];
  rowKey: (row: Row<T>) => string;
  searchPlaceholder?: string;
  toolbar?: ReactNode;
  empty?: Empty;
  pageSize?: number;
  onRowClick?: (row: Row<T>) => void;
  exportName?: string;
  allowExport?: boolean;
};

export const DataTable = <T extends Page>({
  allowExport = true,
  options,
  columns,
  rowKey,
  searchPlaceholder,
  toolbar,
  empty = "Nothing here yet",
  pageSize = 10,
  onRowClick,
  exportName = "export",
}: Props<T>) => {
  const [page, setPage] = useState(1);
  const [text, setText] = useState("");
  const [q, setQ] = useState("");

  useEffect(() => {
    const timer = setTimeout(() => setQ(text.trim()), 300);
    return () => clearTimeout(timer);
  }, [text]);

  const query = {
    q: searchPlaceholder && q ? q : undefined,
    page,
    pageSize,
  };

  // Back to the first page whenever the search, filters or app scope change.
  const resetKey = JSON.stringify(options({ ...query, page: 1 }).queryKey);
  useEffect(() => setPage(1), [resetKey]);

  // A selection outlives paging and search, but not a change of app or filter.
  const selection = useRowSelection(rowKey);
  const clearSelection = selection.clear;
  const scopeKey = JSON.stringify(
    options({ page: 1, pageSize, q: undefined }).queryKey,
  );
  useEffect(() => clearSelection(), [scopeKey, clearSelection]);

  const { data, isLoading, error, refetch } = useQuery(options(query));

  const rows = data?.data ?? [];
  const total = data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / pageSize));

  const showHeader = searchPlaceholder || allowExport || toolbar;

  return (
    <Card className="overflow-hidden">
      {showHeader ? (
        <div className="flex flex-wrap items-center justify-between gap-3 p-3">
          {searchPlaceholder ? (
            <TableSearch
              placeholder={searchPlaceholder}
              value={text}
              onChange={setText}
            />
          ) : (
            <span />
          )}

          <div className="flex flex-wrap items-center gap-2">
            {rows.length > 0 && allowExport && (
              <ExportBar
                count={selection.selected.size}
                onClear={selection.clear}
                onExport={() =>
                  exportCsv(
                    exportName,
                    columns,
                    selection.selected.size
                      ? [...selection.selected.values()]
                      : rows,
                  )
                }
              />
            )}

            {toolbar}
          </div>
        </div>
      ) : null}

      {rows.length > 0 ? (
        <>
          <Table className={showHeader ? "border-t-0 border-line" : ""}>
            <thead>
              <tr>
                <Th className={selectColumnClass}>
                  <Checkbox
                    label="Select all rows on this page"
                    checked={rows.every(selection.isSelected)}
                    indeterminate={
                      rows.some(selection.isSelected) &&
                      !rows.every(selection.isSelected)
                    }
                    onChange={() => selection.toggleAll(rows)}
                  />
                </Th>
                {columns.map((column) => (
                  <Th key={column.header} className={column.className}>
                    {column.header}
                  </Th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr
                  key={rowKey(row)}
                  className={rowClass(selection.isSelected(row), !!onRowClick)}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                >
                  <Td className={selectColumnClass}>
                    <Checkbox
                      label="Select row"
                      checked={selection.isSelected(row)}
                      onChange={() => selection.toggle(row)}
                    />
                  </Td>
                  {columns.map((column) => (
                    <Td key={column.header} className={column.className}>
                      {column.cell(row)}
                    </Td>
                  ))}
                </tr>
              ))}
            </tbody>
          </Table>

          {pages > 1 || total > pageSize ? (
            <div className="flex items-center justify-between gap-3 border-t border-line px-4 py-3 text-xs text-muted">
              <span>
                {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, total)}{" "}
                of {total}
              </span>

              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="iconSm"
                  aria-label="Previous page"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => p - 1)}
                >
                  <IconChevronLeft className="size-4" />
                </Button>
                <span className="px-1 tabular-nums">
                  {page} / {pages}
                </span>
                <Button
                  variant="ghost"
                  size="iconSm"
                  aria-label="Next page"
                  disabled={page >= pages}
                  onClick={() => setPage((p) => p + 1)}
                >
                  <IconChevronRight className="size-4" />
                </Button>
              </div>
            </div>
          ) : null}
        </>
      ) : (
        <div className="border-t border-line">
          <TableState
            loading={isLoading}
            error={error}
            searching={!!q}
            empty={empty}
            onRetry={() => void refetch()}
          />
        </div>
      )}
    </Card>
  );
};
