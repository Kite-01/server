import { IconInfoCircle } from "@tabler/icons-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";

export const isTestnet = !!document.querySelector('meta[name="kite-testnet"]');

export const TestnetBanner = () => {
  const [open, setOpen] = useState(false);

  if (!isTestnet) return null;

  return (
    <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 bg-pending px-4 py-2.5 text-sm font-medium text-white md:h-14 md:flex-nowrap">
      <span className="flex min-w-0 items-center gap-2">
        <IconInfoCircle className="size-4 shrink-0" />
        <span className="md:truncate">
          You are on a testnet instance of Kite.
        </span>
      </span>

      <Button
        size="sm"
        className="h-9 shrink-0 px-4.5"
        onClick={() => setOpen(true)}
      >
        Learn more
      </Button>

      <Dialog
        open={open}
        onOpenChange={setOpen}
        title="This is a testnet instance"
        description="Kite runs here on test networks, so every token, payment and payout uses test funds with no real value. Use it to try things out; don't send real funds to any address it shows."
      >
        <div className="flex justify-end">
          <Button onClick={() => setOpen(false)}>Got it</Button>
        </div>
      </Dialog>
    </div>
  );
};
