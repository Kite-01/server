import { Search } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, Td, Th } from "@/components/ui/table";
import type { Column } from "@/components/data-table";
import {
  Checkbox,
  ExportBar,
  exportCsv,
  rowClass,
  selectColumnClass,
  useRowSelection,
} from "@/components/table-export";

type Props<Row> = {
  rows: Row[] | undefined;
  loading: boolean;
  error?: Error | null;
  columns: Column<Row>[];
  rowKey: (row: Row) => string;
  searchPlaceholder?: string;
  searchText?: (row: Row) => string;
  toolbar?: ReactNode;
  empty?: string;
  exportName?: string;
};

export const SimpleTable = <Row,>({
  rows,
  loading,
  error,
  columns,
  rowKey,
  searchPlaceholder,
  searchText,
  toolbar,
  empty = "Nothing here yet",
  exportName = "export",
}: Props<Row>) => {
  const [q, setQ] = useState("");
  const selection = useRowSelection(rowKey);

  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!rows || !needle || !searchText) return rows ?? [];
    return rows.filter((row) => searchText(row).toLowerCase().includes(needle));
  }, [rows, q, searchText]);

  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line p-4">
        {searchPlaceholder ? (
          <div className="relative w-full max-w-xs">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
            <Input
              className="rounded-full pl-9"
              placeholder={searchPlaceholder}
              value={q}
              onChange={(event) => setQ(event.target.value)}
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
                label="Select all rows"
                checked={
                  visible.length > 0 && visible.every(selection.isSelected)
                }
                indeterminate={
                  visible.some(selection.isSelected) &&
                  !visible.every(selection.isSelected)
                }
                onChange={() => selection.toggleAll(visible)}
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
          {visible.map((row) => (
            <tr
              key={rowKey(row)}
              className={rowClass(selection.isSelected(row), false)}
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

      {loading && (
        <p className="p-8 text-center text-sm text-muted">Loading…</p>
      )}
      {error && (
        <p className="p-8 text-center text-sm text-danger">{error.message}</p>
      )}
      {!loading && !error && visible.length === 0 && (
        <p className="p-8 text-center text-sm text-muted">
          {q ? "No results match your search" : empty}
        </p>
      )}
    </Card>
  );
};
