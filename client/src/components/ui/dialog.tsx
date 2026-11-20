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
      <Primitive.Overlay className="fixed inset-0 z-40 bg-black/20 backdrop-blur-[2px] data-[state=closed]:animate-[fade-out_150ms] data-[state=open]:animate-[fade-in_150ms]" />
      <Primitive.Content
        className={cn(
          "fixed left-1/2 top-1/2 z-50 max-h-[90vh] w-[calc(100vw-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-xl border border-line bg-surface p-6 shadow-xl focus:outline-none data-[state=open]:animate-[fade-in_150ms]",
          className,
        )}
      >
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <Primitive.Title className="text-lg font-semibold">
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
          <Primitive.Close className="rounded-full p-1.5 text-muted hover:bg-soft hover:text-ink">
            <IconX className="size-4" />
            <span className="sr-only">Close</span>
          </Primitive.Close>
        </div>
        {children}
      </Primitive.Content>
    </Primitive.Portal>
  </Primitive.Root>
);
