import { IconX } from "@tabler/icons-react";
import { Dialog as Primitive } from "radix-ui";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

type DialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: ReactNode;
  className?: string;
};

export const Dialog = ({
  open,
  onOpenChange,
  title,
  description,
  children,
  className,
}: DialogProps) => (
  <Primitive.Root open={open} onOpenChange={onOpenChange}>
    <Primitive.Portal>
      <Primitive.Overlay className="fixed inset-0 z-40 bg-black/25 data-[state=closed]:animate-[fade-out_150ms] data-[state=open]:animate-[fade-in_150ms]" />
      <Primitive.Content
        className={cn(
          "fixed left-1/2 top-1/2 z-50 max-h-[90vh] w-[calc(100vw-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-3xl bg-surface p-7 shadow-[0_24px_80px_-12px_rgb(0_0_0/0.25)] focus:outline-none data-[state=open]:animate-[pop-dialog_180ms_cubic-bezier(0.2,0.8,0.2,1)]",
          className,
        )}
      >
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <Primitive.Title className="text-xl font-medium tracking-tight">
              {title}
            </Primitive.Title>
            <Primitive.Description
              className={cn(
                "mt-1 text-sm text-muted",
                !description && "sr-only",
              )}
            >
              {description ?? title}
            </Primitive.Description>
          </div>
          <Primitive.Close className="rounded-full border border-line p-2 text-muted transition-colors hover:bg-soft hover:text-ink">
            <IconX className="size-4" />
            <span className="sr-only">Close</span>
          </Primitive.Close>
        </div>
        {children}
      </Primitive.Content>
    </Primitive.Portal>
  </Primitive.Root>
);
