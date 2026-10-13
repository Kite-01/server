import { cn } from "@/lib/utils";

export const Logo = ({ className }: { className?: string }) => (
  <span
    className={cn(
      "flex items-center gap-2 font-display text-lg font-semibold",
      className,
    )}
  >
    <img src="/icon.svg" alt="" className="size-7" />
    Kite
  </span>
);
