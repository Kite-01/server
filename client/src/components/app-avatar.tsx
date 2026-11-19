import SmartImage from "@/components/smart-image";
import { initials } from "@/lib/format";
import { cn } from "@/lib/utils";

export const AppAvatar = ({
  name,
  icon,
  className,
}: {
  name: string;
  icon?: string | null;
  className?: string;
}) => {
  const letter = ({ className: inner }: { className?: string }) => (
    <span
      className={cn(
        inner,
        "flex items-center justify-center rounded-lg border-0 bg-ink text-xs font-medium text-white",
        className,
      )}
    >
      {initials(name).slice(0, 1)}
    </span>
  );

  return icon ? (
    <SmartImage
      url={icon}
      className={cn("rounded-lg", className)}
      fallbackComponent={({ className: c }) => letter({ className: c })}
    />
  ) : (
    letter({ className: "size-9" })
  );
};
