import { cva, type VariantProps } from "class-variance-authority";
import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

const variants = cva(
  "inline-flex items-center gap-1 rounded-full text-xs font-normal font-display border",
  {
    variants: {
      variant: {
        count: "border border-line bg-surface px-2 py-0.5 text-muted",
        success: "bg-success/10 bg-success/20 px-2.5 py-1 text-success",
        pending: "bg-pending/10 bg-pending/20 px-2.5 py-1 text-pending",
        warning: "bg-warning/10 border-warning/20 px-2.5 py-1 text-warning",
        danger: "bg-danger/10 bg-danger/20 px-2.5 py-1 text-danger",
        neutral: "bg-soft bg-soft/20 px-2.5 py-1 text-muted",
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
