import { useQuery } from "@tanstack/react-query";
import {
  IconExternalLink,
  IconLogout,
  IconShieldCheck,
} from "@tabler/icons-react";
import { getApiOverviewInfoOptions } from "@/api/@tanstack/react-query.gen";
import { CopyButton } from "@/components/copy-button";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { shortAddress } from "@/lib/format";
import { useSession } from "@/lib/session";

const storageLabels = {
  memory: "Key kept in memory",
  session: "Key kept for this session",
  local: "Key kept on this device",
};

export const ProfileMenu = () => {
  const { signOut, storage } = useSession();
  const { data } = useQuery(getApiOverviewInfoOptions());

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="icon" aria-label="Account">
          <IconShieldCheck className="size-4.5" stroke={1.6} />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80 p-0">
        <div className="p-4">
          <p className="text-sm font-semibold">Root</p>
          <p className="text-xs text-muted">{storageLabels[storage]}</p>
        </div>

        <DropdownMenuSeparator />

        <div className="flex items-center justify-between p-4 text-sm">
          <span className="text-muted">Version</span>
          {data ? (
            <span className="font-medium">v{data.version}</span>
          ) : (
            <Skeleton className="h-3 w-12" />
          )}
        </div>

        <DropdownMenuSeparator />

        {!!data?.chains.length && (
          <>
            <div className="space-y-2 p-4">
              <p className="text-xs font-medium text-muted">Operator wallet</p>
              {data.chains.map((chain) => (
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
                      <IconExternalLink className="size-4" />
                    </a>
                  </div>
                </div>
              ))}
            </div>

            <DropdownMenuSeparator />
          </>
        )}

        <DropdownMenuItem className="m-1" onSelect={signOut}>
          <IconLogout className="size-4" />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};
