import { cva, type VariantProps } from "class-variance-authority";
import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

const dot = "before:size-1.5 before:rounded-full before:bg-current";

const variants = cva(
  "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full text-xs font-medium",
  {
    variants: {
      variant: {
        count: "border border-line bg-surface px-2 py-0.5 text-muted",
        success: `${dot} bg-success/8 px-2.5 py-1 text-success`,
        pending: `${dot} bg-pending/8 px-2.5 py-1 text-pending`,
        warning: `${dot} bg-warning/10 px-2.5 py-1 text-warning`,
        danger: `${dot} bg-danger/8 px-2.5 py-1 text-danger`,
        neutral: "bg-soft px-2.5 py-1 text-muted",
      },
    },
    defaultVariants: { variant: "neutral" },
  },
);

export const Badge = ({
  className,
  variant,
  ...props
}: HTMLAttributes<HTMLSpanElement> & VariantProps<typeof variants>) => (
  <span className={cn(variants({ variant }), className)} {...props} />
);
