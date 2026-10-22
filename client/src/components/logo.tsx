import { cn } from "@/lib/utils";

export const Logo = ({
  className,
  imgClassName,
  hideLabel = false,
}: {
  className?: string;
  imgClassName?: string;
  hideLabel?: boolean;
}) => (
  <span
    className={cn(
      "flex items-center gap-2 font-display text-lg font-semibold",
      className,
    )}
  >
    <img src="/icon.svg" alt="" className={cn("size-7", imgClassName)} />
    {hideLabel ? null : "Kite"}
  </span>
);
