import type { ReactNode } from "react";
import { Label } from "@/components/ui/input";

export const Field = ({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) => (
  <div className="space-y-1.5">
    <Label>{label}</Label>
    {children}
    {hint && <p className="text-xs text-muted">{hint}</p>}
  </div>
);

export const CheckboxGroup = <T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string }[];
  value: T[];
  onChange: (value: T[]) => void;
}) => (
  <div className="flex flex-wrap gap-2">
    {options.map((option) => {
      const checked = value.includes(option.value);

      return (
        <label
          key={option.value}
          className="flex cursor-pointer items-center gap-2 rounded-full border border-line px-3 py-1.5 text-xs has-[:checked]:border-ink has-[:checked]:bg-soft"
        >
          <input
            type="checkbox"
            className="accent-ink"
            checked={checked}
            onChange={() =>
              onChange(
                checked
                  ? value.filter((item) => item !== option.value)
                  : [...value, option.value],
              )
            }
          />
          {option.label}
        </label>
      );
    })}
  </div>
);
