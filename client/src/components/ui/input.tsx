import type {
  InputHTMLAttributes,
  LabelHTMLAttributes,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from "react";
import { cn } from "@/lib/utils";
import { IconChevronDown } from "@tabler/icons-react";

const field =
  "w-full rounded-lg border border-line bg-surface px-3 text-sm text-ink transition-colors placeholder:text-muted hover:border-ink/20 focus-visible:border-ink focus-visible:outline-none disabled:bg-soft disabled:text-muted";

export const Input = ({
  className,
  ...props
}: InputHTMLAttributes<HTMLInputElement>) => (
  <input className={cn(field, "h-9.5", className)} {...props} />
);

export const Textarea = ({
  className,
  ...props
}: TextareaHTMLAttributes<HTMLTextAreaElement>) => (
  <textarea
    className={cn(field, "min-h-24 py-2 text-xs", className)}
    {...props}
  />
);

export const Select = ({
  className,
  wrapperClassName,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement> & { wrapperClassName?: string }) => (
  <div className={cn("relative w-full", wrapperClassName)}>
    <select
      className={cn(
        field,
        "h-9.5 appearance-none bg-no-repeat pr-8",
        className,
      )}
      {...props}
    />

    <IconChevronDown className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
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
