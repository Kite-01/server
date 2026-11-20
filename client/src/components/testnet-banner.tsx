import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";

export const isTestnet = !!document.querySelector('meta[name="kite-testnet"]');

export const TestnetBanner = () => {
  const [open, setOpen] = useState(false);

  if (!isTestnet) return null;

  return (
    <div className="flex h-9 shrink-0 items-center justify-center gap-2 bg-ink px-4 text-[13px] text-white/80">
      <span className="size-1.5 rounded-full bg-kite" aria-hidden />
      <span className="truncate">
        Testnet
        <span className="max-sm:hidden">
          : every payment here uses test funds
        </span>
      </span>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="shrink-0 font-medium text-white underline-offset-2 hover:underline"
      >
        Learn more
      </button>

      <Dialog
        open={open}
        onOpenChange={setOpen}
        title="This is a testnet instance"
        description="Kite runs here on test networks, so every token, payment and payout uses test funds with no real value."
      >
        <div className="flex justify-end gap-2">
          <Button onClick={() => setOpen(false)}>Got it</Button>
        </div>
      </Dialog>
    </div>
  );
};
