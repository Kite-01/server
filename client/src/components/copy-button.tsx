import { Check, Copy } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";

export const CopyButton = ({
  value,
  label,
}: {
  value: string;
  label?: string;
}) => {
  const [copied, setCopied] = useState(false);

  return (
    <Button
      variant="ghost"
      size={label ? "sm" : "iconSm"}
      aria-label={label ?? "Copy"}
      onClick={async () => {
        await navigator.clipboard.writeText(value);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
    >
      {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
      {label}
    </Button>
  );
};
