import type {
  InputHTMLAttributes,
  LabelHTMLAttributes,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from "react";
import { cn } from "@/lib/utils";
import { IconChevronDown } from "@tabler/icons-react";

const field =
  "w-full rounded-xl border border-line bg-surface px-3 text-sm text-ink placeholder:text-muted focus-visible:border-ink focus-visible:outline-none disabled:bg-soft disabled:text-muted";

export const Input = ({
  className,
  ...props
}: InputHTMLAttributes<HTMLInputElement>) => (
  <input className={cn(field, "h-10", className)} {...props} />
);

export const Textarea = ({
  className,
  ...props
}: TextareaHTMLAttributes<HTMLTextAreaElement>) => (
  <textarea
    className={cn(field, "min-h-24 py-2 font-mono text-xs", className)}
    {...props}
  />
);

export const Select = ({
  className,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement>) => (
  <div className="relative w-full">
    <select
      className={cn(
        field,
        "h-10.5 appearance-none bg-no-repeat pr-8",
        className,
      )}
      {...props}
    />

    <IconChevronDown className="pointer-events-none absolute right-5 top-1/2 size-4 -translate-y-1/2 opacity-60" />
  </div>
);

export const Label = ({
  className,
  ...props
}: LabelHTMLAttributes<HTMLLabelElement>) => (
  <label
    className={cn("text-xs font-medium text-muted", className)}
    {...props}
  />
);
