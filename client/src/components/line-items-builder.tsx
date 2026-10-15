import { IconPlus, IconTrash } from "@tabler/icons-react";
import type { PaymentLink } from "@/api/types.gen";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { nextRowId } from "@/lib/utils";

type LineItem = NonNullable<PaymentLink["lineItems"]>[number];

export type LineItemRow = {
  id: number;
  name: string;
  price: string;
  quantity: string;
  image: string;
};

// The API's amount format: up to 20 integer and 18 fraction digits.
const AmountPattern = "(?:0|[1-9][0-9]{0,19})(?:\\.[0-9]{1,18})?";

export const toLineItemRows = (items: LineItem[] | null): LineItemRow[] =>
  (items ?? []).map((item, index) => ({
    id: index,
    name: item.name,
    price: item.price,
    quantity: String(item.quantity),
    image: item.image ?? "",
  }));

export const fromLineItemRows = (rows: LineItemRow[]): LineItem[] =>
  rows.map((row) => ({
    name: row.name.trim(),
    price: row.price.trim(),
    quantity: Number(row.quantity),
    image: row.image.trim() || null,
  }));

export const LineItemsBuilder = ({
  rows,
  currency,
  onChange,
}: {
  rows: LineItemRow[];
  currency: string;
  onChange: (rows: LineItemRow[]) => void;
}) => {
  const update = (id: number, patch: Partial<LineItemRow>) =>
    onChange(rows.map((row) => (row.id === id ? { ...row, ...patch } : row)));

  return (
    <div className="space-y-2">
      {rows.length > 0 && (
        <div className="divide-y divide-line rounded-lg border border-line">
          {rows.map((row) => (
            <div key={row.id} className="space-y-2 p-3">
              <div className="flex gap-2">
                <Input
                  required
                  maxLength={200}
                  className="min-w-0 flex-1"
                  placeholder="Item name"
                  aria-label="Item name"
                  value={row.name}
                  onChange={(event) =>
                    update(row.id, { name: event.target.value })
                  }
                />
                <Input
                  required
                  inputMode="decimal"
                  pattern={AmountPattern}
                  title="A price like 12.50"
                  className="w-28 shrink-0"
                  placeholder={`Price (${currency})`}
                  aria-label={`Price in ${currency}`}
                  value={row.price}
                  onChange={(event) =>
                    update(row.id, { price: event.target.value })
                  }
                />
                <Input
                  required
                  type="number"
                  min={1}
                  step={1}
                  className="w-16 shrink-0"
                  aria-label="Quantity"
                  title="Quantity"
                  value={row.quantity}
                  onChange={(event) =>
                    update(row.id, { quantity: event.target.value })
                  }
                />
                <Button
                  variant="ghost"
                  size="icon"
                  className="text-muted hover:text-danger"
                  aria-label="Remove item"
                  onClick={() =>
                    onChange(rows.filter((item) => item.id !== row.id))
                  }
                >
                  <IconTrash className="size-4" />
                </Button>
              </div>
              <Input
                type="url"
                placeholder="Image URL (optional)"
                aria-label="Image URL"
                value={row.image}
                onChange={(event) =>
                  update(row.id, { image: event.target.value })
                }
              />
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
            {
              id: nextRowId(rows),
              name: "",
              price: "",
              quantity: "1",
              image: "",
            },
          ])
        }
      >
        <IconPlus className="size-4" />
        Add line item
      </Button>
    </div>
  );
};
