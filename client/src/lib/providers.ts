import type { ProviderStatus } from "@/api/types.gen";

export const providerActionLabels: Record<ProviderStatus["action"], string> = {
  GasSponsor: "Gas sponsor",
  OnchainNotifier: "Deposit notifier",
  Payout: "Payouts",
};
