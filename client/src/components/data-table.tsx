import { useQuery, type UseQueryOptions } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, Search } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import {
  Checkbox,
  ExportBar,
  exportCsv,
  rowClass,
  selectColumnClass,
  useRowSelection,
} from "@/components/table-export";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, Td, Th } from "@/components/ui/table";
import { IconBug, IconLoader2 } from "@tabler/icons-react";
import { cn } from "@/lib/utils";
import { Card } from "./ui/card";

export type Column<Row> = {
  header: string;
  cell: (row: Row) => ReactNode;
  // What a CSV export holds for this column; defaults to the cell's text.
  exportValue?: (row: Row) => string | number | boolean | null | undefined;
  className?: string;
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
  empty?: string;
  pageSize?: number;
  onRowClick?: (row: Row<T>) => void;
  exportName?: string;
};

export const DataTable = <T extends Page>({
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

  const { data, isLoading, error } = useQuery(options(query));

  const rows = data?.data ?? [];
  const total = data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line p-4">
        {searchPlaceholder ? (
          <div className="relative w-full max-w-xs">
            <Search className="absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted" />
            <Input
              className="rounded-full pl-10 h-11 font-light"
              placeholder={searchPlaceholder}
              value={text}
              onChange={(event) => setText(event.target.value)}
            />
          </div>
        ) : (
          <span />
        )}

        <div className="flex flex-wrap items-center gap-2">
          <ExportBar
            count={selection.selected.size}
            onClear={selection.clear}
            onExport={() =>
              exportCsv(exportName, columns, [...selection.selected.values()])
            }
          />

          {toolbar}
        </div>
      </div>

      <Table>
        <thead>
          <tr>
            <Th className={selectColumnClass}>
              <Checkbox
                label="Select all rows on this page"
                checked={rows.length > 0 && rows.every(selection.isSelected)}
                indeterminate={
                  rows.some(selection.isSelected) &&
                  !rows.every(selection.isSelected)
                }
                onChange={() => selection.toggleAll(rows)}
              />
            </Th>
            {columns.map((column) => (
              <Th
                key={column.header}
                className={cn(
                  "font-display text-sm font-normal text-black",
                  column.className,
                )}
              >
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

      {isLoading && (
        <div className="h-30 gap-2 flex items-center justify-center">
          <IconLoader2 className="animate-spin size-5" strokeWidth={1.5} />
          <span className="font-display">Loading...</span>
        </div>
      )}

      {error && (
        <div className="h-40 gap-3 flex flex-col items-center justify-center">
          <div className="text-center flex items-center justify-center text-danger">
            <span className="font-display">{error.message}</span>
          </div>

          <Button>
            Report
            <IconBug strokeWidth={1.5} />
          </Button>
        </div>
      )}

      {!isLoading && !error && rows.length === 0 && (
        <p className="p-8 text-center text-sm text-muted">
          {q ? "No results match your search" : empty}
        </p>
      )}

      <div className="flex items-center justify-between gap-3 p-4 text-sm text-muted">
        <span>
          {total === 0
            ? "0 results"
            : `${(page - 1) * pageSize + 1}–${Math.min(page * pageSize, total)} of ${total}`}
        </span>

        <div className="flex items-center gap-1">
          <Button
            variant="outline"
            size="iconSm"
            aria-label="Previous page"
            disabled={page <= 1}
            onClick={() => setPage((p) => p - 1)}
          >
            <ChevronLeft className="size-4" />
          </Button>

          <span className="px-2">
            {page} / {pages}
          </span>

          <Button
            variant="outline"
            size="iconSm"
            aria-label="Next page"
            disabled={page >= pages}
            onClick={() => setPage((p) => p + 1)}
          >
            <ChevronRight className="size-4" />
          </Button>
        </div>
      </div>
    </Card>
  );
};
