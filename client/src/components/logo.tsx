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
      "flex items-center gap-2 text-lg font-semibold tracking-[-0.03em]",
      className,
    )}
  >
    <img src="/icon.svg" alt="" className={cn("h-5 w-auto", imgClassName)} />
    {hideLabel ? null : "Kite"}
  </span>
);
