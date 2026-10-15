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
  IconArrowLeft,
} from "@tabler/icons-react";
import { Dialog } from "radix-ui";
import { useEffect, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { Logo } from "@/components/logo";
import { ProfileMenu } from "@/components/profile-menu";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
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
  <nav className="flex flex-col gap-0.5">
    {items.map((item) => (
      <NavLink
        key={item.to}
        to={item.to}
        end={item.end}
        className={({ isActive }) =>
          cn(
            "flex h-9 items-center gap-2.5 rounded-lg px-2.5 text-sm transition-colors",
            isActive
              ? "bg-soft font-medium text-ink"
              : "text-muted hover:bg-soft/70 hover:text-ink",
          )
        }
      >
        <item.icon className="size-4.5" stroke={1.6} />
        {item.label}
      </NavLink>
    ))}
  </nav>
);

// Which app the pages act on, and the way back to the server's pages.
const AppContext = () => {
  const { appId, name } = useAppScope();
  const navigate = useNavigate();
  if (!appId) return null;

  return (
    <div className="rounded-lg border border-pending/50 bg-pending/20 p-3 flex items-center gap-2">
      <Button
        type="button"
        size={"iconSm"}
        className="size-6.5"
        onClick={() => navigate("/apps")}
      >
        <IconArrowLeft className="size-3.5" />
      </Button>
      {name ? (
        <p className="font-display text-base font-medium">{name}</p>
      ) : (
        <Skeleton className="my-1 h-3 w-24 bg-line" />
      )}
    </div>
  );
};

const Sidebar = ({ items }: { items: Item[] }) => (
  <>
    <Logo imgClassName="size-7" className="px-1 text-xl" />
    <AppContext />
    <Nav items={items} />
  </>
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
        <Dialog.Content className="fixed inset-y-0 left-0 z-50 flex w-72 max-w-[85vw] flex-col gap-5 overflow-y-auto border-r border-line bg-surface p-4 shadow-xl focus:outline-none data-[state=closed]:animate-[drawer-out_200ms_ease-in] data-[state=open]:animate-[drawer-in_200ms_ease-out] md:hidden">
          <div className="absolute right-3 top-3">
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

          <Sidebar items={items} />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
};

export const Shell = () => {
  const { appId } = useAppScope();
  const items = appId ? appItems(`/apps/${appId}`) : rootItems;

  return (
    <div className="flex min-h-full">
      <aside className="sticky top-0 hidden h-screen w-56 shrink-0 flex-col gap-5 overflow-y-auto border-r border-line bg-surface p-4 md:flex">
        <Sidebar items={items} />
      </aside>

      <main className="min-w-0 flex-1">
        <header className="flex h-14 items-center justify-between gap-4 px-4 sm:px-8 md:justify-end">
          <div className="flex items-center gap-1 md:hidden">
            <MobileNav items={items} />
            <Logo imgClassName="size-7" hideLabel />
          </div>

          <ProfileMenu />
        </header>

        <div className="mx-auto w-full max-w-6xl px-4 pb-16 pt-2 sm:px-8">
          <Outlet />
        </div>
      </main>
    </div>
  );
};
