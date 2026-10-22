import { useQuery } from "@tanstack/react-query";
import { IconPower, IconSettings2 } from "@tabler/icons-react";
import { overviewInfoOptions } from "@/api/@tanstack/react-query.gen";
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
import { Badge } from "./ui/badge";

const chainTypeLabels = {
  Evm: "EVM",
};

export const ProfileMenu = () => {
  const { signOut } = useSession();
  const { data } = useQuery(overviewInfoOptions());

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="icon" aria-label="Account">
          <IconSettings2 className="size-4.5" stroke={1.6} />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80 p-0">
        <div className="flex items-center justify-between p-4 text-sm">
          {data ? (
            <Badge variant={"count"}>v{data.version}</Badge>
          ) : (
            <Skeleton className="h-3 w-12" />
          )}
        </div>

        {!!data?.operators.length && (
          <>
            <div className="space-y-1 px-4">
              <p className="text-xs font-medium text-muted">Addresses</p>

              {data.operators.map((operator) => (
                <div
                  key={operator.chainType}
                  className="w-full flex items-center justify-between text-sm"
                >
                  <p className="font-display font-medium">
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
