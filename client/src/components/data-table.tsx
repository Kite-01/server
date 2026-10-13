import { ChevronLeft, ChevronRight, Search } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, Td, Th } from "@/components/ui/table";
import { useGet, type Page } from "@/lib/queries";

export type Column<Row> = {
  header: string;
  cell: (row: Row) => ReactNode;
  className?: string;
};

type Props<Row> = {
  path: string;
  query?: Record<string, string | number | boolean | null | undefined>;
  columns: Column<Row>[];
  rowKey: (row: Row) => string;
  searchPlaceholder?: string;
  toolbar?: ReactNode;
  empty?: string;
  pageSize?: number;
  onRowClick?: (row: Row) => void;
};

export const DataTable = <Row,>({
  path,
  query,
  columns,
  rowKey,
  searchPlaceholder,
  toolbar,
  empty = "Nothing here yet",
  pageSize = 10,
  onRowClick,
}: Props<Row>) => {
  const [page, setPage] = useState(1);
  const [text, setText] = useState("");
  const [q, setQ] = useState("");

  useEffect(() => {
    const timer = setTimeout(() => {
      setQ(text.trim());
      setPage(1);
    }, 300);

    return () => clearTimeout(timer);
  }, [text]);

  const filterKey = JSON.stringify(query ?? {});
  useEffect(() => setPage(1), [filterKey, path]);

  const { data, isLoading, error } = useGet<Page<Row>>(path, {
    ...query,
    q: searchPlaceholder ? q : undefined,
    page,
    pageSize,
  });

  const rows = data?.data ?? [];
  const total = data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <Card>
      {(searchPlaceholder || toolbar) && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line p-4">
          {searchPlaceholder ? (
            <div className="relative w-full max-w-xs">
              <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
              <Input
                className="rounded-full pl-9"
                placeholder={searchPlaceholder}
                value={text}
                onChange={(event) => setText(event.target.value)}
              />
            </div>
          ) : (
            <span />
          )}
          <div className="flex items-center gap-2">{toolbar}</div>
        </div>
      )}

      <Table>
        <thead>
          <tr>
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
              className={
                onRowClick ? "cursor-pointer hover:bg-soft/60" : undefined
              }
              onClick={onRowClick ? () => onRowClick(row) : undefined}
            >
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
        <p className="p-8 text-center text-sm text-muted">Loading…</p>
      )}
      {error && (
        <p className="p-8 text-center text-sm text-danger">{error.message}</p>
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
