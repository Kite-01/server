import {
  AppWindow,
  ArrowLeftRight,
  ArrowLeft,
  BadgePercent,
  Eye,
  KeyRound,
  LayoutDashboard,
  Link2,
  LineChart,
  Network,
  Quote,
  Settings2,
  Users,
  Webhook,
  type LucideIcon,
} from "lucide-react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { Logo } from "@/components/logo";
import { ProfileMenu } from "@/components/profile-menu";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useAppScope } from "@/lib/queries";

type Item = { to: string; label: string; icon: LucideIcon; end?: boolean };

const rootItems: Item[] = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard, end: true },
  { to: "/chains", label: "Chains", icon: Network },
  { to: "/fees", label: "Fees", icon: BadgePercent },
  { to: "/apps", label: "Apps", icon: AppWindow },
  { to: "/kv", label: "KV", icon: Settings2 },
  { to: "/price-feeds", label: "Price feeds", icon: LineChart },
];

const appItems = (base: string): Item[] => [
  { to: base, label: "Dashboard", icon: LayoutDashboard, end: true },
  { to: `${base}/fees`, label: "Fees", icon: BadgePercent },
  { to: `${base}/customers`, label: "Customers", icon: Users },
  { to: `${base}/api-keys`, label: "API keys", icon: KeyRound },
  { to: `${base}/payment-links`, label: "Payment links", icon: Link2 },
  { to: `${base}/quotes`, label: "Quotes", icon: Quote },
  { to: `${base}/transfers`, label: "Transfers", icon: ArrowLeftRight },
  { to: `${base}/webhooks`, label: "Webhooks", icon: Webhook },
];

export const Shell = () => {
  const { appId, name } = useAppScope();
  const navigate = useNavigate();
  const items = appId ? appItems(`/apps/${appId}`) : rootItems;

  return (
    <div className="mx-auto flex min-h-full max-w-[1600px] flex-col bg-surface">
      {appId && (
        <div className="flex flex-wrap items-center justify-between gap-3 bg-warning px-4 py-2.5 text-sm font-medium text-white">
          <span className="flex items-center gap-2">
            <Eye className="size-4" />
            You are viewing {name ?? "this app"} as root. Changes you make here
            apply to this app.
          </span>
          <Button size="sm" variant="secondary" onClick={() => navigate("/")}>
            <ArrowLeft className="size-4" />
            Back to root dashboard
          </Button>
        </div>
      )}

      <div className="flex flex-1">
        <aside className="hidden w-60 shrink-0 flex-col gap-6 border-r border-line p-5 md:flex">
          <Logo />
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
                <item.icon className="size-[18px]" />
                {item.label}
              </NavLink>
            ))}
          </nav>
        </aside>

        <main className="min-w-0 flex-1">
          <header className="flex items-center justify-between gap-4 px-6 py-4 md:justify-end">
            <Logo className="md:hidden" />
            <ProfileMenu />
          </header>
          <nav className="flex gap-1 overflow-x-auto px-6 pb-4 md:hidden">
            {items.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  cn(
                    "flex shrink-0 items-center gap-2 rounded-full px-3 py-1.5 text-xs font-medium",
                    isActive ? "bg-ink text-white" : "bg-soft text-muted",
                  )
                }
              >
                <item.icon className="size-3.5" />
                {item.label}
              </NavLink>
            ))}
          </nav>
          <div className="px-6 pb-10">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
};
