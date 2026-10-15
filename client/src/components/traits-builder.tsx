import { IconPlus, IconTrash } from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { nextRowId } from "@/lib/utils";

type TraitType = "string" | "number" | "boolean" | "json";

export type TraitRow = {
  id: number;
  key: string;
  type: TraitType;
  value: string;
};

const typeLabels: Record<TraitType, string> = {
  string: "Text",
  number: "Number",
  boolean: "True / false",
  json: "JSON",
};

export const toTraitRows = (
  traits: Record<string, unknown> | null,
): TraitRow[] =>
  Object.entries(traits ?? {}).map(([key, value], index) => {
    const type: TraitType =
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean"
        ? (typeof value as TraitType)
        : "json";

    return {
      id: index,
      key,
      type,
      value: type === "json" ? JSON.stringify(value) : String(value),
    };
  });

export const fromTraitRows = (
  rows: TraitRow[],
): { traits: Record<string, unknown> | null } | { error: string } => {
  if (!rows.length) return { traits: null };

  const entries: [string, unknown][] = [];
  for (const row of rows) {
    const key = row.key.trim();
    if (!key) return { error: "Every trait needs a name" };
    if (entries.some(([name]) => name === key)) {
      return { error: `${key} is used twice` };
    }

    if (row.type === "number") {
      const number = Number(row.value);
      if (!row.value.trim() || !Number.isFinite(number)) {
        return { error: `${key} must be a number` };
      }
      entries.push([key, number]);
    } else if (row.type === "json") {
      try {
        entries.push([key, JSON.parse(row.value)]);
      } catch {
        return { error: `${key} must be valid JSON` };
      }
    } else {
      entries.push([
        key,
        row.type === "boolean" ? row.value === "true" : row.value,
      ]);
    }
  }

  return { traits: Object.fromEntries(entries) };
};

export const TraitsBuilder = ({
  rows,
  onChange,
}: {
  rows: TraitRow[];
  onChange: (rows: TraitRow[]) => void;
}) => {
  const update = (id: number, patch: Partial<TraitRow>) =>
    onChange(rows.map((row) => (row.id === id ? { ...row, ...patch } : row)));

  return (
    <div className="space-y-2">
      {rows.length > 0 && (
        <div className="divide-y divide-line rounded-lg border border-line">
          {rows.map((row) => (
            <div
              key={row.id}
              className="grid grid-cols-[minmax(0,1fr)_8rem_minmax(0,1fr)_auto] gap-2 p-3"
            >
              <Input
                required
                placeholder="Name, e.g. plan"
                aria-label="Trait name"
                value={row.key}
                onChange={(event) =>
                  update(row.id, { key: event.target.value })
                }
              />
              <Select
                aria-label="Value type"
                value={row.type}
                onChange={(event) => {
                  const type = event.target.value as TraitType;
                  update(row.id, {
                    type,
                    value:
                      type === "boolean"
                        ? "true"
                        : row.type === "boolean"
                          ? ""
                          : row.value,
                  });
                }}
              >
                {Object.entries(typeLabels).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </Select>
              {row.type === "boolean" ? (
                <Select
                  aria-label="Value"
                  value={row.value}
                  onChange={(event) =>
                    update(row.id, { value: event.target.value })
                  }
                >
                  <option value="true">true</option>
                  <option value="false">false</option>
                </Select>
              ) : (
                <Input
                  inputMode={row.type === "number" ? "decimal" : undefined}
                  className={
                    row.type === "json"
                      ? "font-mono placeholder:font-sans"
                      : undefined
                  }
                  placeholder={
                    row.type === "json" ? '{ "city": "Lagos" }' : "Value"
                  }
                  aria-label="Value"
                  value={row.value}
                  onChange={(event) =>
                    update(row.id, { value: event.target.value })
                  }
                />
              )}
              <Button
                variant="ghost"
                size="icon"
                className="text-muted hover:text-danger"
                aria-label="Remove trait"
                onClick={() =>
                  onChange(rows.filter((item) => item.id !== row.id))
                }
              >
                <IconTrash className="size-4" />
              </Button>
            </div>
          ))}
        </div>
      )}
      <Button
        variant="outline"
        size="sm"
        onClick={() =>
          onChange([
            ...rows,
            { id: nextRowId(rows), key: "", type: "string", value: "" },
          ])
        }
      >
        <IconPlus className="size-4" />
        Add trait
      </Button>
    </div>
  );
};
