import { Badge } from "@/components/ui/badge";

const statuses: Record<string, "success" | "pending" | "warning" | "danger"> = {
  Settled: "success",
  Created: "pending",
  AwaitingDeposit: "pending",
  DepositReceived: "pending",
  Processing: "pending",
  x402Settled: "pending",
  Refunded: "warning",
  Failed: "danger",
  Cancelled: "danger",
};

const label = (status: string) => status.replace(/([a-z])([A-Z])/g, "$1 $2");

export const StatusBadge = ({ status }: { status: string }) => {
  const variant = statuses[status] ?? "pending";

  return <Badge variant={variant}>{label(status)}</Badge>;
};
