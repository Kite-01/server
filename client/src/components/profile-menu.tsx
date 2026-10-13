import { ExternalLink, LogOut, ShieldCheck } from "lucide-react";
import { CopyButton } from "@/components/copy-button";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { shortAddress } from "@/lib/format";
import { useGet } from "@/lib/queries";
import { useSession } from "@/lib/session";

type System = {
  version: string;
  operatorAddress: string;
  update: { version: string; url: string } | null;
  chains: {
    id: string;
    caip2Id: string;
    name: string;
    isActive: boolean;
    isConfigured: boolean;
    operatorAddress: string;
    explorerUrl: string;
  }[];
};

const storageLabels = {
  memory: "Key kept in memory",
  session: "Key kept for this session",
  local: "Key kept on this device",
};

export const ProfileMenu = () => {
  const { signOut, storage } = useSession();
  const { data } = useGet<System>("/api/admin/system");

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="secondary"
          size="icon"
          className="relative"
          aria-label="Account"
        >
          <ShieldCheck className="size-5" />
          {data?.update && (
            <span className="absolute right-1 top-1 size-2.5 rounded-full bg-brand ring-2 ring-page" />
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80 p-0">
        <div className="p-4">
          <p className="text-sm font-semibold">Root</p>
          <p className="text-xs text-muted">{storageLabels[storage]}</p>
        </div>
        <DropdownMenuSeparator />

        <div className="space-y-1 p-4 text-sm">
          <div className="flex items-center justify-between">
            <span className="text-muted">Version</span>
            <span className="font-medium">
              {data ? `v${data.version}` : "…"}
            </span>
          </div>
          {data?.update ? (
            <a
              href={data.update.url}
              target="_blank"
              rel="noreferrer"
              className="flex items-center justify-between rounded-lg bg-brand-soft px-3 py-2 text-brand"
            >
              <span>Update available: v{data.update.version}</span>
              <ExternalLink className="size-4" />
            </a>
          ) : (
            data && <p className="text-xs text-muted">You are up to date</p>
          )}
        </div>
        <DropdownMenuSeparator />

        <div className="space-y-2 p-4">
          <p className="text-xs font-medium text-muted">Operator wallet</p>
          {data && data.chains.length === 0 && (
            <div className="flex items-center justify-between text-sm">
              <span className="font-mono">
                {shortAddress(data.operatorAddress)}
              </span>
              <CopyButton value={data.operatorAddress} />
            </div>
          )}
          {data?.chains.map((chain) => (
            <div
              key={chain.id}
              className="flex items-center justify-between gap-2 text-sm"
            >
              <div className="min-w-0">
                <p className="truncate font-medium">{chain.name}</p>
                <p className="font-mono text-xs text-muted">
                  {shortAddress(chain.operatorAddress)}
                </p>
              </div>
              <div className="flex shrink-0">
                <CopyButton value={chain.operatorAddress} />
                <a
                  href={chain.explorerUrl}
                  target="_blank"
                  rel="noreferrer"
                  aria-label="Open in explorer"
                  className="inline-flex size-8 items-center justify-center rounded-full hover:bg-soft"
                >
                  <ExternalLink className="size-4" />
                </a>
              </div>
            </div>
          ))}
        </div>
        <DropdownMenuSeparator />

        <DropdownMenuItem className="m-1" onSelect={signOut}>
          <LogOut className="size-4" />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};
