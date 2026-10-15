import { IconInbox, type Icon } from "@tabler/icons-react";
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
  icon: Icon = IconInbox,
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
    <span className="flex size-10 items-center justify-center rounded-xl border border-line bg-surface text-muted shadow-[0_1px_0_var(--color-line)]">
      <Icon className="size-5" stroke={1.5} />
    </span>
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
