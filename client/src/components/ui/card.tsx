import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export const Card = ({
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn("rounded-card border border-line/80 bg-surface", className)}
    {...props}
  />
);
