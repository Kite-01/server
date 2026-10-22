import { Popover as Primitive } from "radix-ui";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

export const Popover = Primitive.Root;
export const PopoverTrigger = Primitive.Trigger;

export const PopoverContent = ({
  className,
  sideOffset = 8,
  align = "end",
  ...props
}: ComponentProps<typeof Primitive.Content>) => (
  <Primitive.Portal>
    <Primitive.Content
      sideOffset={sideOffset}
      align={align}
      className={cn(
        "z-50 rounded-xl border border-line bg-surface p-4 shadow-lg",
        className,
      )}
      {...props}
    />
  </Primitive.Portal>
);
