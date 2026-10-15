import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

// A span, so it can stand in for text inside headings and paragraphs.
export const Skeleton = ({
  className,
  ...props
}: HTMLAttributes<HTMLSpanElement>) => (
  <span
    className={cn("block animate-pulse rounded-full bg-soft", className)}
    {...props}
  />
);
