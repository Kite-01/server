import { DropdownMenu as Primitive } from "radix-ui";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

export const DropdownMenu = Primitive.Root;
export const DropdownMenuTrigger = Primitive.Trigger;

export const DropdownMenuContent = ({
  className,
  sideOffset = 8,
  ...props
}: ComponentProps<typeof Primitive.Content>) => (
  <Primitive.Portal>
    <Primitive.Content
      sideOffset={sideOffset}
      className={cn(
        "z-50 min-w-48 rounded-xl border border-line bg-surface p-1 shadow-lg",
        className,
      )}
      {...props}
    />
  </Primitive.Portal>
);

export const DropdownMenuItem = ({
  className,
  ...props
}: ComponentProps<typeof Primitive.Item>) => (
  <Primitive.Item
    className={cn(
      "flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-sm outline-none data-[disabled]:opacity-50 data-[highlighted]:bg-soft",
      className,
    )}
    {...props}
  />
);

export const DropdownMenuSeparator = () => (
  <Primitive.Separator className="my-1 h-px bg-line" />
);
