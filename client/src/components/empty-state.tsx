import type { Icon } from "@tabler/icons-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export type EmptyStateProps = {
  icon?: Icon;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
};

export const EmptyState = ({
  title,
  description,
  action,
  className,
}: EmptyStateProps) => (
  <div
    className={cn(
      "flex flex-col items-center justify-center gap-4 px-6 py-14 text-center",
      className,
    )}
  >
    <img
      src="/empty.svg"
      alt=""
      className="h-24 w-auto select-none"
      draggable={false}
    />
    <div className="space-y-1">
      <p className="font-display text-sm font-medium text-ink">{title}</p>
      {description ? (
        <p className="mx-auto max-w-sm text-sm text-muted">{description}</p>
      ) : null}
    </div>
    {action}
  </div>
);

/** A table's empty state, given as a short title or in full. */
export type Empty = string | EmptyStateProps;

export const toEmptyState = (empty: Empty): EmptyStateProps =>
  typeof empty === "string" ? { title: empty } : empty;
