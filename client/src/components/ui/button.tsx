import { cva, type VariantProps } from "class-variance-authority";
import type { ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

const variants = cva(
  "inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-full text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        default: "bg-ink text-white hover:bg-ink/85",
        secondary: "bg-soft text-ink hover:bg-line",
        outline: "border border-line bg-surface text-ink hover:bg-soft",
        ghost: "text-ink hover:bg-soft",
        danger: "bg-danger text-white hover:bg-danger/90",
      },
      size: {
        default: "h-10.5 px-5",
        sm: "h-8 px-3 text-xs",
        icon: "size-10",
        iconSm: "size-8",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> &
  VariantProps<typeof variants>;

export const Button = ({
  className,
  variant,
  size,
  type = "button",
  ...props
}: ButtonProps) => (
  <button
    type={type}
    className={cn(variants({ variant, size }), className)}
    {...props}
  />
);
