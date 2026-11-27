import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import {
  IconPower,
  IconSearch,
  IconSelector,
  IconSettings2,
} from "@tabler/icons-react";
import { overviewInfoOptions } from "@/api/@tanstack/react-query.gen";
import { CopyButton } from "@/components/copy-button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { shortAddress } from "@/lib/format";
import { useSession } from "@/lib/session";
import { Badge } from "./ui/badge";

const trustWallet = (folder: string) =>
  `https://cdn.jsdelivr.net/gh/trustwallet/assets@master/blockchains/${folder}/info/logo.png`;

const chainTypes = {
  Evm: { label: "EVM", logo: trustWallet("ethereum") },
  Near: { label: "NEAR", logo: trustWallet("near") },
  Stellar: { label: "Stellar", logo: trustWallet("stellar") },
  Gno: { label: "Gno.land", logo: "https://gno.land/public/imgs/gnoland.svg" },
};

export const ProfileMenu = () => {
  const { signOut } = useSession();
  const { data } = useQuery(overviewInfoOptions());
  const [search, setSearch] = useState("");
  const term = search.trim().toLowerCase();
  const operators = (data?.operators ?? []).filter(
    (operator) =>
      chainTypes[operator.chainType].label.toLowerCase().includes(term) ||
      operator.address.toLowerCase().includes(term),
  );

  return (
    <DropdownMenu onOpenChange={() => setSearch("")}>
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
            <div className="px-4 pb-3">
              <div className="relative">
                <IconSearch className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
                <Input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  // the menu's own keyboard navigation would take the keys
                  onKeyDown={(event) => event.stopPropagation()}
                  placeholder="Search chains or addresses"
                  aria-label="Search operator wallets"
                  autoFocus
                  spellCheck={false}
                  className="h-8.5 pl-9 text-xs"
                />
              </div>
            </div>

            <div className="max-h-64 space-y-2 overflow-y-auto px-4 pb-3">
              {operators.map((operator) => (
                <div
                  key={operator.chainType}
                  className="flex w-full items-center justify-between gap-3 text-sm"
                >
                  <span className="flex min-w-0 items-center gap-2.5">
                    <img
                      src={chainTypes[operator.chainType].logo}
                      alt=""
                      className="size-6 shrink-0 rounded-full bg-soft object-contain"
                    />
                    <span className="truncate font-medium">
                      {chainTypes[operator.chainType].label}
                    </span>
                  </span>

                  <div className="flex shrink-0 items-center">
                    <p className="text-xs text-muted">
                      {shortAddress(operator.address)}
                    </p>
                    <CopyButton value={operator.address} />
                  </div>
                </div>
              ))}
              {!operators.length && (
                <p className="py-2 text-center text-xs text-muted">
                  No wallet matches “{search.trim()}”
                </p>
              )}
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
