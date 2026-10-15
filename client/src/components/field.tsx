import type { ReactNode } from "react";
import { Label } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { IconInfoCircle } from "@tabler/icons-react";
import { Tooltip, TooltipTrigger, TooltipContent } from "./ui/tooltip";

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
    <Label className="flex items-center gap-1">
      <span>{label}</span>
      {hint && (
        <Tooltip>
          <TooltipTrigger>
            <IconInfoCircle className="size-3.5" strokeWidth={1.5} />
          </TooltipTrigger>
          <TooltipContent>
            <p className="text-center">{hint}</p>
          </TooltipContent>
        </Tooltip>
      )}
    </Label>
    {children}
  </div>
);

export type CheckboxOption<T extends string> = {
  value: T;
  label: string;
  /** Why the option can't be picked; the option is disabled when set. */
  unavailable?: ReactNode;
};

export const CheckboxGroup = <T extends string>({
  options,
  value,
  onChange,
}: {
  options: CheckboxOption<T>[];
  value: T[];
  onChange: (value: T[]) => void;
}) => (
  <div className="flex flex-wrap gap-2">
    {options.map((option) => {
      const checked = value.includes(option.value);
      const disabled = !!option.unavailable && !checked;

      return (
        <div key={option.value} className="space-y-1">
          <label
            className={cn(
              "flex w-max items-center gap-2 rounded-lg border border-line px-2.5 py-1.5 text-xs transition-colors has-checked:border-ink has-checked:bg-soft",
              disabled
                ? "cursor-not-allowed bg-soft/50 text-muted"
                : "cursor-pointer hover:border-ink/30",
            )}
          >
            <input
              type="checkbox"
              className="accent-ink"
              checked={checked}
              disabled={disabled}
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
          {option.unavailable ? (
            <p className="text-xs text-muted">{option.unavailable}</p>
          ) : null}
        </div>
      );
    })}
  </div>
);
