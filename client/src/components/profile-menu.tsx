import { useQuery } from "@tanstack/react-query";
import { IconPower, IconSelector, IconSettings2 } from "@tabler/icons-react";
import { overviewInfoOptions } from "@/api/@tanstack/react-query.gen";
import { CopyButton } from "@/components/copy-button";
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
import { Badge } from "./ui/badge";

const chainTypeLabels = {
  Evm: "EVM",
  Near: "NEAR",
  Stellar: "Stellar",
  Gno: "Gno.land",
};

export const ProfileMenu = () => {
  const { signOut } = useSession();
  const { data } = useQuery(overviewInfoOptions());

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="flex w-full items-center gap-3 rounded-2xl p-2 text-start transition-colors hover:bg-black/[0.04] data-[state=open]:bg-black/[0.04]"
        >
          <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-soft text-ink">
            <IconSettings2 className="size-4.5" stroke={1.6} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium">Operator</span>
            <span className="block truncate text-xs text-muted">
              {data ? `Kite v${data.version}` : "Root key"}
            </span>
          </span>
          <IconSelector className="size-4 shrink-0 text-muted" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        side="top"
        collisionPadding={16}
        className="z-60 w-80 max-w-[calc(100vw-2rem)] p-0"
      >
        <div className="flex items-center justify-between p-4 text-sm">
          <span className="font-medium">Operator wallets</span>
          {data ? (
            <Badge variant={"count"}>v{data.version}</Badge>
          ) : (
            <Skeleton className="h-3 w-12" />
          )}
        </div>

        {!!data?.operators.length && (
          <>
            <div className="space-y-1 px-4 pb-2">
              {data.operators.map((operator) => (
                <div
                  key={operator.chainType}
                  className="w-full flex items-center justify-between text-sm"
                >
                  <p className="font-medium">
                    {chainTypeLabels[operator.chainType]}
                  </p>

                  <div className="flex items-center">
                    <p className="text-xs text-muted">
                      {shortAddress(operator.address)}
                    </p>
                    <CopyButton value={operator.address} />
                  </div>
                </div>
              ))}
            </div>

            <DropdownMenuSeparator />
          </>
        )}

        <DropdownMenuItem
          className="m-1.5 text-danger font-medium"
          onSelect={signOut}
        >
          <IconPower className="size-4" />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};
