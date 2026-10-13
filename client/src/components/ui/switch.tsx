import { Switch as Primitive } from "radix-ui";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

export const Switch = ({
  className,
  ...props
}: ComponentProps<typeof Primitive.Root>) => (
  <Primitive.Root
    className={cn(
      "relative h-6 w-10 shrink-0 rounded-full bg-line transition-colors data-[state=checked]:bg-ink disabled:opacity-50",
      className,
    )}
    {...props}
  >
    <Primitive.Thumb className="block size-5 translate-x-0.5 rounded-full bg-white shadow transition-transform data-[state=checked]:translate-x-[18px]" />
  </Primitive.Root>
);
