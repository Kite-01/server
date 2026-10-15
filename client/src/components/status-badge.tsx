import {
  IconArrowBackUp,
  IconCircleCheck,
  IconCircleDashed,
  IconCircleX,
  IconClock,
} from "@tabler/icons-react";
import { Badge } from "@/components/ui/badge";

const statuses: Record<
  string,
  {
    variant: "success" | "pending" | "warning" | "danger";
    icon: typeof IconClock;
  }
> = {
  Settled: { variant: "success", icon: IconCircleCheck },
  Created: { variant: "pending", icon: IconCircleDashed },
  AwaitingDeposit: { variant: "pending", icon: IconClock },
  DepositReceived: { variant: "pending", icon: IconClock },
  Processing: { variant: "pending", icon: IconClock },
  x402Settled: { variant: "pending", icon: IconClock },
  Refunded: { variant: "warning", icon: IconArrowBackUp },
  Failed: { variant: "danger", icon: IconCircleX },
  Cancelled: { variant: "danger", icon: IconCircleX },
};

const label = (status: string) => status.replace(/([a-z])([A-Z])/g, "$1 $2");

export const StatusBadge = ({ status }: { status: string }) => {
  const { variant, icon: Icon } = statuses[status] ?? {
    variant: "pending" as const,
    icon: IconClock,
  };

  return (
    <Badge variant={variant}>
      <Icon className="size-3.5" />
      {label(status)}
    </Badge>
  );
};
