import type { HTMLAttributes, TdHTMLAttributes, ThHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export const Table = ({
  className,
  ...props
}: HTMLAttributes<HTMLTableElement>) => (
  <div className="w-full overflow-x-auto">
    <table className={cn("w-full text-left text-sm", className)} {...props} />
  </div>
);

export const Th = ({
  className,
  ...props
}: ThHTMLAttributes<HTMLTableCellElement>) => (
  <th
    className={cn(
      "whitespace-nowrap border-b border-line bg-soft/50 px-4 py-2.5 text-xs font-medium text-muted",
      className,
    )}
    {...props}
  />
);

export const Td = ({
  className,
  ...props
}: TdHTMLAttributes<HTMLTableCellElement>) => (
  <td
    className={cn(
      "border-b border-line px-4 py-3 align-middle [tr:last-child>&]:border-b-0 whitespace-nowrap",
      className,
    )}
    {...props}
  />
);
