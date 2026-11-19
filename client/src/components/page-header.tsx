import { IconBook2 } from "@tabler/icons-react";
import type { ReactNode } from "react";

export const DocsLink = ({ href }: { href: string }) => (
  <a
    href={href}
    target="_blank"
    rel="noreferrer"
    className="inline-flex h-10 items-center gap-1.5 rounded-full px-3.5 text-sm text-muted transition-colors hover:bg-surface hover:text-ink"
  >
    <IconBook2 className="size-4" stroke={1.6} />
    Docs
  </a>
);

export const PageHeader = ({
  title,
  description,
  action,
  docs,
}: {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  docs?: string;
}) => (
  <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
    <div className="min-w-0 space-y-2">
      <h1 className="text-[34px] leading-none font-normal tracking-[-0.04em] sm:text-[40px]">
        {title}
      </h1>
      {description ? (
        <p className="max-w-2xl text-[15px] text-muted">{description}</p>
      ) : null}
    </div>
    {docs || action ? (
      <div className="flex flex-wrap items-center gap-2">
        {docs ? <DocsLink href={docs} /> : null}
        {action}
      </div>
    ) : null}
  </div>
);
