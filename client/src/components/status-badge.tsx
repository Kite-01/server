import {
  CheckCircle2,
  CircleDashed,
  Clock,
  RotateCcw,
  XCircle,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";

const statuses: Record<
  string,
  { variant: "success" | "pending" | "warning" | "danger"; icon: typeof Clock }
> = {
  Settled: { variant: "success", icon: CheckCircle2 },
  Created: { variant: "pending", icon: CircleDashed },
  AwaitingDeposit: { variant: "pending", icon: Clock },
  DepositReceived: { variant: "pending", icon: Clock },
  Processing: { variant: "pending", icon: Clock },
  x402Settled: { variant: "pending", icon: Clock },
  Refunded: { variant: "warning", icon: RotateCcw },
  Failed: { variant: "danger", icon: XCircle },
  Cancelled: { variant: "danger", icon: XCircle },
};

const label = (status: string) => status.replace(/([a-z])([A-Z])/g, "$1 $2");

export const StatusBadge = ({ status }: { status: string }) => {
  const { variant, icon: Icon } = statuses[status] ?? {
    variant: "pending" as const,
    icon: Clock,
  };

  return (
    <Badge variant={variant}>
      <Icon className="size-3.5" />
      {label(status)}
    </Badge>
  );
};
