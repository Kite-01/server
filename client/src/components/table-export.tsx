import {
  isValidElement,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { Column } from "@/components/data-table";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { IconX } from "@tabler/icons-react";

// Best-effort plain text of a rendered cell, for columns without an
// exportValue. Components that render their text internally (rather than
// through children) come out empty, so those columns set exportValue.
const nodeText = (node: ReactNode): string => {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string") return node;
  if (typeof node === "number" || typeof node === "bigint") {
    return String(node);
  }

  if (Array.isArray(node)) {
    return node
      .map((child) =>
        isValidElement(child) ? ` ${nodeText(child)} ` : nodeText(child),
      )
      .join("");
  }

  if (isValidElement(node)) {
    return nodeText((node.props as { children?: ReactNode }).children);
  }

  return "";
};

const cellValue = <Row,>(column: Column<Row>, row: Row) => {
  const value = column.exportValue
    ? column.exportValue(row)
    : nodeText(column.cell(row));

  return value == null ? "" : String(value).replace(/\s+/g, " ").trim();
};

// Spreadsheet apps run cells starting with these as formulas.
const neutralise = (value: string) =>
  /^[=+@\t\r]/.test(value) || /^-[^\d.]/.test(value) ? `'${value}` : value;

const csvCell = (value: string) => {
  const safe = neutralise(value);
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

export const exportCsv = <Row,>(
  name: string,
  columns: Column<Row>[],
  rows: Row[],
) => {
  const exported = columns.filter((column) => column.header);
  const lines = [
    exported.map((column) => csvCell(column.header)).join(","),
    ...rows.map((row) =>
      exported.map((column) => csvCell(cellValue(column, row))).join(","),
    ),
  ];

  const date = new Date().toISOString().slice(0, 10);
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-") || "export";
  const blob = new Blob([`﻿${lines.join("\r\n")}\r\n`], {
    type: "text/csv;charset=utf-8",
  });

  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${slug}-${date}.csv`;
  link.click();
  URL.revokeObjectURL(url);
};

// Selected rows are kept by key, so a selection survives paging and search.
export const useRowSelection = <Row,>(rowKey: (row: Row) => string) => {
  const [selected, setSelected] = useState<Map<string, Row>>(new Map());

  const toggle = (row: Row) =>
    setSelected((current) => {
      const next = new Map(current);
      const key = rowKey(row);
      if (next.has(key)) next.delete(key);
      else next.set(key, row);
      return next;
    });

  const toggleAll = (rows: Row[]) =>
    setSelected((current) => {
      const next = new Map(current);
      const all = rows.every((row) => next.has(rowKey(row)));
      for (const row of rows) {
        if (all) next.delete(rowKey(row));
        else next.set(rowKey(row), row);
      }
      return next;
    });

  const clear = useCallback(() => setSelected(new Map()), []);

  return {
    selected,
    isSelected: (row: Row) => selected.has(rowKey(row)),
    toggle,
    toggleAll,
    clear,
  };
};

export const Checkbox = ({
  checked,
  indeterminate = false,
  onChange,
  label,
}: {
  checked: boolean;
  indeterminate?: boolean;
  onChange: () => void;
  label: string;
}) => {
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (ref.current) ref.current.indeterminate = indeterminate;
  }, [indeterminate]);

  return (
    <input
      ref={ref}
      type="checkbox"
      aria-label={label}
      className="size-4 cursor-pointer align-middle accent-ink"
      checked={checked}
      onChange={onChange}
      onClick={(event) => event.stopPropagation()}
    />
  );
};

export const ExportBar = ({
  count,
  onExport,
  onClear,
}: {
  count: number;
  onExport: () => void;
  onClear: () => void;
}) => (
  <div className="flex items-center gap-1">
    {count > 0 && (
      <Button variant="ghost" size="sm" onClick={onClear}>
        <IconX className="size-3.5" />
        {count} selected
      </Button>
    )}

    <Button
      variant="ghost"
      size="sm"
      className="text-muted hover:text-ink"
      title={count > 0 ? "Export the selected rows" : "Export the rows shown"}
      onClick={onExport}
    >
      Export CSV
    </Button>
  </div>
);

export const selectColumnClass = "w-10 pr-0";

export const rowClass = (selected: boolean, clickable: boolean) =>
  cn(
    "transition-colors",
    clickable && "cursor-pointer hover:bg-soft/60",
    selected && "bg-brand-soft/60",
  );
