import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export const Card = ({
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn("rounded-2xl border border-line bg-surface", className)}
    {...props}
  />
);
