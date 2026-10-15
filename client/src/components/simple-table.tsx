import { useMemo, useState, type ReactNode } from "react";
import { Card } from "@/components/ui/card";
import { Table, Td, Th } from "@/components/ui/table";
import { TableSearch, TableState, type Column } from "@/components/data-table";
import type { Empty } from "@/components/empty-state";
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
  empty?: Empty;
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
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 p-3">
        {searchPlaceholder ? (
          <TableSearch
            placeholder={searchPlaceholder}
            value={q}
            onChange={setQ}
          />
        ) : (
          <span />
        )}
        <div className="flex flex-wrap items-center gap-2">
          {visible.length > 0 && (
            <ExportBar
              count={selection.selected.size}
              onClear={selection.clear}
              onExport={() =>
                exportCsv(
                  exportName,
                  columns,
                  selection.selected.size
                    ? [...selection.selected.values()]
                    : visible,
                )
              }
            />
          )}
          {toolbar}
        </div>
      </div>

      {visible.length > 0 ? (
        <Table className="border-t border-line">
          <thead>
            <tr>
              <Th className={selectColumnClass}>
                <Checkbox
                  label="Select all rows"
                  checked={visible.every(selection.isSelected)}
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
      ) : (
        <div className="border-t border-line">
          <TableState
            loading={loading}
            error={error}
            searching={!!q.trim()}
            empty={empty}
          />
        </div>
      )}
    </Card>
  );
};
