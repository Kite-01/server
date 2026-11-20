import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { docs } from "@/lib/docs";

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
        description="Kite runs here on test networks, so every token, payment and payout uses test funds with no real value. Use it to try things out; don't send real funds to any address it shows."
      >
        <div className="flex justify-end gap-2">
          <a
            href={docs.testnets}
            target="_blank"
            rel="noreferrer"
            className="inline-flex h-10 items-center rounded-full px-4 text-sm text-muted hover:bg-soft hover:text-ink"
          >
            Read about testnets
          </a>
          <Button onClick={() => setOpen(false)}>Got it</Button>
        </div>
      </Dialog>
    </div>
  );
};
