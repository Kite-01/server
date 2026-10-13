import {
  type Icon,
  IconDashboard,
  IconBlocks,
  IconDiscount2,
  IconAppWindow,
  IconSecretPhrases,
  IconTag,
  IconUserCircle,
  IconKey,
  IconPaywall,
  IconReceipt2,
  IconArrowsExchange,
  IconWebhook,
  IconMenu,
  IconX,
  IconInfoCircle,
} from "@tabler/icons-react";
import { Dialog } from "radix-ui";
import { useEffect, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { Logo } from "@/components/logo";
import { ProfileMenu } from "@/components/profile-menu";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useAppScope } from "@/lib/queries";

type Item = {
  to: string;
  label: string;
  icon: Icon;
  end?: boolean;
};

const rootItems: Item[] = [
  { to: "/", label: "Dashboard", icon: IconDashboard, end: true },
  { to: "/chains", label: "Chains", icon: IconBlocks },
  { to: "/fees", label: "Fees", icon: IconDiscount2 },
  { to: "/apps", label: "Apps", icon: IconAppWindow },
  { to: "/kv", label: "KV", icon: IconSecretPhrases },
  { to: "/price-feeds", label: "Price feeds", icon: IconTag },
];

const appItems = (base: string): Item[] => [
  { to: base, label: "Dashboard", icon: IconDashboard, end: true },
  { to: `${base}/fees`, label: "Fees", icon: IconDiscount2 },
  { to: `${base}/customers`, label: "Customers", icon: IconUserCircle },
  { to: `${base}/api-keys`, label: "API keys", icon: IconKey },
  { to: `${base}/payment-links`, label: "Payment links", icon: IconPaywall },
  { to: `${base}/quotes`, label: "Quotes", icon: IconReceipt2 },
  { to: `${base}/transfers`, label: "Transfers", icon: IconArrowsExchange },
  { to: `${base}/webhooks`, label: "Webhooks", icon: IconWebhook },
];

const Nav = ({ items }: { items: Item[] }) => (
  <nav className="flex flex-col gap-1">
    {items.map((item) => (
      <NavLink
        key={item.to}
        to={item.to}
        end={item.end}
        className={({ isActive }) =>
          cn(
            "flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors",
            isActive
              ? "bg-soft text-ink"
              : "text-muted hover:bg-soft hover:text-ink",
          )
        }
      >
        <item.icon className="size-4.5" />
        {item.label}
      </NavLink>
    ))}
  </nav>
);

const MobileNav = ({ items }: { items: Item[] }) => {
  const [open, setOpen] = useState(false);
  const { pathname } = useLocation();

  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => {
    const wide = window.matchMedia("(min-width: 768px)");
    const close = (event: MediaQueryListEvent) =>
      event.matches && setOpen(false);

    wide.addEventListener("change", close);
    return () => wide.removeEventListener("change", close);
  }, []);

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="-ml-2 md:hidden"
          aria-label="Open navigation"
        >
          <IconMenu className="size-5" />
        </Button>
      </Dialog.Trigger>

      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/30 data-[state=closed]:animate-[fade-out_150ms] data-[state=open]:animate-[fade-in_150ms] md:hidden" />
        <Dialog.Content className="fixed inset-y-0 left-0 z-50 flex w-72 max-w-[85vw] flex-col gap-6 overflow-y-auto border-r border-line bg-surface p-5 shadow-xl focus:outline-none data-[state=closed]:animate-[drawer-out_200ms_ease-in] data-[state=open]:animate-[drawer-in_200ms_ease-out] md:hidden">
          <div className="flex items-center justify-between">
            <Logo imgClassName="size-9" className="text-2xl" />
            <Dialog.Close asChild>
              <Button
                variant="ghost"
                size="iconSm"
                aria-label="Close navigation"
              >
                <IconX className="size-4" />
              </Button>
            </Dialog.Close>
          </div>

          <Dialog.Title className="sr-only">Navigation</Dialog.Title>
          <Dialog.Description className="sr-only">
            Pages of the dashboard
          </Dialog.Description>

          <Nav items={items} />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
};

export const Shell = () => {
  const { appId, name } = useAppScope();
  const navigate = useNavigate();
  const items = appId ? appItems(`/apps/${appId}`) : rootItems;

  return (
    <div className="mx-auto flex min-h-full max-w-400 flex-col bg-surface/10">
      {appId && (
        <div className="flex flex-wrap items-center justify-between gap-3 bg-warning px-4 py-2.5 text-sm font-medium text-white">
          <span className="flex items-center gap-2">
            <IconInfoCircle className="size-4 shrink-0" />
            You are viewing {name ?? "this app"}, changes you make here apply to
            this app.
          </span>

          <Button
            size="sm"
            className="h-9 px-4.5"
            onClick={() => navigate("/")}
          >
            Back to main
          </Button>
        </div>
      )}

      <div className="flex flex-1">
        <aside className="bg-surface hidden w-60 shrink-0 flex-col gap-6 border-r border-line p-5 md:flex">
          <Logo imgClassName="size-9" className="text-2xl" />
          <Nav items={items} />
        </aside>

        <main className="min-w-0 flex-1">
          <header className="flex items-center justify-between gap-4 px-4 py-4 sm:px-6 md:justify-end">
            <div className="flex items-center gap-1 md:hidden">
              <MobileNav items={items} />
              <Logo imgClassName="size-8" hideLabel />
            </div>

            <ProfileMenu />
          </header>

          <div className="px-4 pb-10 sm:px-6">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
};
