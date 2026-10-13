import { cn } from "@/lib/utils";

export const Logo = ({ className }: { className?: string }) => (
  <span
    className={cn("flex items-center gap-2 text-lg font-semibold", className)}
  >
    <svg viewBox="0 0 24 24" className="size-6" fill="none" aria-hidden>
      <path d="M12 2 4 12l8 3 8-3-8-10Z" fill="currentColor" />
      <path d="m12 15-3 7 3-2 3 2-3-7Z" fill="currentColor" opacity=".55" />
    </svg>
    Kite
  </span>
);
