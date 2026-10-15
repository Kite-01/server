import { IconCheck, IconCopy } from "@tabler/icons-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";

export const CopyButton = ({
  value,
  label,
  className,
  variant = "ghost",
}: {
  value: string;
  label?: string;
  className?: string;
  variant?: "default" | "danger" | "secondary" | "outline" | "ghost";
}) => {
  const [copied, setCopied] = useState(false);

  return (
    <Button
      variant={variant}
      size={label ? "sm" : "iconSm"}
      aria-label={label ?? "Copy"}
      className={className}
      onClick={async () => {
        await navigator.clipboard.writeText(value);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
    >
      {copied ? (
        <IconCheck className="size-3.5" />
      ) : (
        <IconCopy className="size-3.5" />
      )}
      {label}
    </Button>
  );
};
