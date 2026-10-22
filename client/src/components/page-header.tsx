import type { ReactNode } from "react";

export const PageHeader = ({
  title,
  description,
  action,
}: {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
}) => (
  <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
    <div className="min-w-0 space-y-1">
      <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
      {description ? (
        <p className="max-w-2xl text-sm text-muted">{description}</p>
      ) : null}
    </div>
    {action}
  </div>
);
