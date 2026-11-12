import { DropdownMenu as Primitive } from "radix-ui";
import {
  createContext,
  useContext,
  useRef,
  useState,
  type ComponentProps,
  type ReactNode,
} from "react";
import { cn } from "@/lib/utils";

const State = createContext({
  open: false,
  setOpen: (_open: boolean) => {},
});

export const DropdownMenu = ({ children }: { children: ReactNode }) => {
  const [open, setOpen] = useState(false);

  return (
    <State.Provider value={{ open, setOpen }}>
      <Primitive.Root open={open} onOpenChange={setOpen}>
        {children}
      </Primitive.Root>
    </State.Provider>
  );
};

// Radix opens on pointerdown, which iOS can cancel when it takes the touch for
// a scroll, so a touch opens the menu on the tap instead.
export const DropdownMenuTrigger = ({
  onPointerDown,
  onClick,
  ...props
}: ComponentProps<typeof Primitive.Trigger>) => {
  const { open, setOpen } = useContext(State);
  // open when the touch began, as touching outside closes the menu before the tap
  const touch = useRef<{ open: boolean } | null>(null);

  return (
    <Primitive.Trigger
      {...props}
      onPointerDown={(event) => {
        onPointerDown?.(event);
        touch.current = event.pointerType === "touch" ? { open } : null;
        if (touch.current) event.preventDefault();
      }}
      onClick={(event) => {
        onClick?.(event);
        const started = touch.current;
        touch.current = null;
        if (started) setOpen(!started.open);
      }}
    />
  );
};

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
