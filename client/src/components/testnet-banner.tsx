import { IconFlask } from "@tabler/icons-react";

export const isTestnet = !!document.querySelector('meta[name="kite-testnet"]');

export const TestnetBanner = () => {
  if (!isTestnet) return null;

  return (
    <div className="flex min-h-8 shrink-0 items-center justify-center gap-2 bg-pending px-4 py-1.5 text-center text-xs font-medium text-white">
      <IconFlask className="size-4 shrink-0" />
      Testnet: test tokens only, no real value.
    </div>
  );
};
