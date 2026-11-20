import {
  type Icon,
  IconAppWindow,
  IconArrowsExchange,
  IconBlocks,
  IconBook2,
  IconBraces,
  IconChevronLeft,
  IconDatabase,
  IconDiscount2,
  IconKey,
  IconLayoutGrid,
  IconMenu2,
  IconPaywall,
  IconReceipt2,
  IconSecretPhrases,
  IconTag,
  IconUserCircle,
  IconWebhook,
  IconX,
} from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { Dialog } from "radix-ui";
import { useEffect, useState } from "react";
import { Link, NavLink, Outlet, useLocation } from "react-router-dom";
import { overviewInfoOptions } from "@/api/@tanstack/react-query.gen";
import { Logo } from "@/components/logo";
import { ProfileMenu } from "@/components/profile-menu";
import SmartImage from "@/components/smart-image";
import { Button } from "@/components/ui/button";
import { docs } from "@/lib/docs";
import { useAppScope } from "@/lib/queries";
import { cn } from "@/lib/utils";

type Item = { to: string; label: string; icon: Icon; end?: boolean };
type Group = { label?: string; items: Item[] };

const DemoHidden = ["/providers", "/kv"];

const rootGroups: Group[] = [
  {
    items: [
      { to: "/", label: "Overview", icon: IconLayoutGrid, end: true },
      { to: "/apps", label: "Apps", icon: IconAppWindow },
    ],
  },
  {
    label: "Network",
    items: [
      { to: "/chains", label: "Chains", icon: IconBlocks },
      { to: "/fees", label: "Fees", icon: IconDiscount2 },
      { to: "/price-feeds", label: "Price feeds", icon: IconTag },
    ],
  },
  {
    label: "Server",
    items: [
      { to: "/providers", label: "Providers", icon: IconSecretPhrases },
      { to: "/kv", label: "KV store", icon: IconDatabase },
    ],
  },
];

const appGroups = (base: string): Group[] => [
  {
    items: [{ to: base, label: "Overview", icon: IconLayoutGrid, end: true }],
  },
  {
    label: "Payments",
    items: [
      { to: `${base}/transfers`, label: "Transfers", icon: IconArrowsExchange },
      {
        to: `${base}/payment-links`,
        label: "Payment links",
        icon: IconPaywall,
      },
      { to: `${base}/quotes`, label: "Quotes", icon: IconReceipt2 },
      { to: `${base}/customers`, label: "Customers", icon: IconUserCircle },
    ],
  },
  {
    label: "Settings",
    items: [
      { to: `${base}/chains`, label: "Chains", icon: IconBlocks },
      { to: `${base}/fees`, label: "Fees", icon: IconDiscount2 },
      { to: `${base}/api-keys`, label: "API keys", icon: IconKey },
      { to: `${base}/webhooks`, label: "Webhooks", icon: IconWebhook },
    ],
  },
];

const row =
  "flex h-9.5 items-center gap-3 rounded-xl px-3 text-[15px] transition-colors";

const Nav = ({ groups }: { groups: Group[] }) => (
  <nav className="flex flex-col gap-5">
    {groups.map((group, i) => (
      <div key={group.label ?? i} className="flex flex-col gap-0.5">
        {group.label ? (
          <p className="px-3 pb-1.5 text-[13px] text-muted">{group.label}</p>
        ) : null}
        {group.items.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            className={({ isActive }) =>
              cn(
                row,
                isActive
                  ? "bg-ink text-white"
                  : "text-ink/75 hover:bg-black/[0.04] hover:text-ink",
              )
            }
          >
            <item.icon className="size-[18px] shrink-0" stroke={1.6} />
            {item.label}
          </NavLink>
        ))}
      </div>
    ))}
  </nav>
);

const AppSwitch = () => {
  const { appId, name, icon } = useAppScope();
  if (!appId) return null;

  return (
    <div className="rounded-2xl border border-black/20 p-1.5">
      <div className="flex items-center gap-2.5 p-1.5">
        <SmartImage url={icon} alt="" className="size-8 rounded-full" />
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{name ?? "App"}</p>
        </div>
      </div>
      <Link
        to="/apps"
        className="mt-1 flex h-9 items-center gap-1 rounded-[14px] px-2 text-[13px] justify-center transition-colors bg-soft text-ink"
      >
        <IconChevronLeft className="size-3.5" />
        Back to apps
      </Link>
    </div>
  );
};

const Resources = () => (
  <div className="flex flex-col gap-0.5">
    {[
      { href: docs.home, label: "Documentation", icon: IconBook2 },
      { href: "/openapi", label: "API reference", icon: IconBraces },
    ].map((link) => (
      <a
        key={link.href}
        href={link.href}
        target="_blank"
        rel="noreferrer"
        className={cn(row, "text-ink/75 hover:bg-black/[0.04] hover:text-ink")}
      >
        <link.icon className="size-[18px] shrink-0" stroke={1.6} />
        {link.label}
      </a>
    ))}
  </div>
);

const Sidebar = ({ groups }: { groups: Group[] }) => (
  <div className="flex min-h-full flex-col gap-5">
    <Link to="/" className="px-3 pt-1">
      <Logo />
    </Link>
    <AppSwitch />
    <Nav groups={groups} />
    <div className="mt-auto flex flex-col gap-3">
      <Resources />
      <ProfileMenu />
    </div>
  </div>
);

const MobileNav = ({ groups }: { groups: Group[] }) => {
  const [open, setOpen] = useState(false);
  const { pathname } = useLocation();

  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => {
    const wide = window.matchMedia("(min-width: 1024px)");
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
          className="-ms-2 lg:hidden"
          aria-label="Open navigation"
        >
          <IconMenu2 className="size-5" />
        </Button>
      </Dialog.Trigger>

      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/30 data-[state=closed]:animate-[fade-out_150ms] data-[state=open]:animate-[fade-in_150ms] lg:hidden" />
        <Dialog.Content className="fixed inset-y-0 left-0 z-50 w-76 max-w-[85vw] overflow-y-auto bg-surface p-4 shadow-xl focus:outline-none data-[state=closed]:animate-[drawer-out_200ms_ease-in] data-[state=open]:animate-[drawer-in_200ms_ease-out] lg:hidden">
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
          <Sidebar groups={groups} />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
};

export const Shell = () => {
  const { appId } = useAppScope();
  const { data: info } = useQuery(overviewInfoOptions());
  const groups = appId
    ? appGroups(`/apps/${appId}`)
    : rootGroups
        .map((group) => ({
          ...group,
          items: group.items.filter(
            (item) => !info?.demo || !DemoHidden.includes(item.to),
          ),
        }))
        .filter((group) => group.items.length);

  return (
    <div className="mx-auto flex min-h-full max-w-[1600px]">
      <div className="hidden w-68 shrink-0 border-e border-line bg-surface lg:block">
        <aside className="sticky top-0 h-dvh overflow-y-auto px-4 py-6">
          <Sidebar groups={groups} />
        </aside>
      </div>

      <main className="min-w-0 flex-1">
        <header className="flex h-16 items-center justify-between gap-4 px-4 sm:px-8 lg:hidden">
          <div className="flex items-center gap-1">
            <MobileNav groups={groups} />
            <Link to="/">
              <Logo />
            </Link>
          </div>
          {info?.demo && (
            <span className="rounded-full bg-surface px-2.5 py-1 text-xs font-medium text-muted">
              View only
            </span>
          )}
        </header>

        <div className="mx-auto w-full max-w-[1180px] px-4 pb-20 pt-2 sm:px-8 lg:pt-12">
          {info?.demo && (
            <p className="mb-6 hidden w-fit rounded-full bg-surface px-3 py-1 text-xs font-medium text-muted lg:block">
              View only
            </p>
          )}
          <Outlet />
        </div>
      </main>
    </div>
  );
};
