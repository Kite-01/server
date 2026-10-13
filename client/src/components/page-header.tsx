import { IconInfoCircle } from "@tabler/icons-react";
import type { ReactNode } from "react";

export const PageHeader = ({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) => (
  <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
    <div className="flex items-center gap-2">
      <h1 className="text-2xl font-semibold">{title}</h1>
      {description ? (
        <button title={description}>
          <IconInfoCircle />
        </button>
      ) : null}
    </div>
    {action}
  </div>
);
