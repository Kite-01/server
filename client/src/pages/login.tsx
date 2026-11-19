import { IconArrowRight, IconLoader2 } from "@tabler/icons-react";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Logo } from "@/components/logo";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { docs } from "@/lib/docs";
import { useSession, type KeyStorage } from "@/lib/session";
import { cn } from "@/lib/utils";

const options: { value: KeyStorage; title: string; note: string }[] = [
  { value: "memory", title: "Never", note: "Most secure" },
  { value: "session", title: "This session", note: "Until you close it" },
  { value: "local", title: "This device", note: "Until you sign out" },
];

export const Login = () => {
  const { signIn } = useSession();
  const [rootKey, setRootKey] = useState("");
  const [storage, setStorage] = useState<KeyStorage>("session");
  const [pending, setPending] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setPending(true);

    try {
      await signIn(rootKey, storage);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not sign in");
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="flex min-h-full flex-col items-center justify-center gap-8 p-4 py-12">
      <div className="w-full max-w-[420px] animate-[rise-in_400ms_cubic-bezier(0.2,0.8,0.2,1)] rounded-[28px] border border-line/80 bg-surface p-8 shadow-[0_24px_60px_-30px_rgb(0_0_0/0.25)] sm:p-10">
        <Logo className="text-xl" imgClassName="h-6" />
        <h1 className="mt-10 text-[32px] leading-tight font-normal tracking-[-0.04em]">
          Sign in to Kite
        </h1>
        <p className="mt-2 text-[15px] text-muted">
          Use this server's root key, the{" "}
          <code className="rounded-md bg-soft px-1.5 py-0.5 font-mono text-[13px] text-ink">
            KITE_ROOT_KEY
          </code>{" "}
          it was started with.
        </p>

        <form className="mt-8 space-y-6" onSubmit={submit}>
          <div className="space-y-2">
            <div className="flex items-baseline justify-between">
              <Label htmlFor="rootKey" className="text-sm text-ink">
                Root key
              </Label>
              <a
                href={docs.configuration}
                target="_blank"
                rel="noreferrer"
                className="text-[13px] text-muted underline-offset-2 hover:text-ink hover:underline"
              >
                Where do I find it?
              </a>
            </div>
            <Input
              id="rootKey"
              type="password"
              autoComplete="off"
              autoFocus
              className="h-12 font-mono"
              value={rootKey}
              onChange={(event) => setRootKey(event.target.value)}
            />
          </div>

          <fieldset className="space-y-2">
            <legend className="mb-2 text-sm">Keep me signed in</legend>
            <div className="grid grid-cols-3 gap-1 rounded-2xl bg-soft p-1">
              {options.map((option) => (
                <label
                  key={option.value}
                  className={cn(
                    "cursor-pointer rounded-xl px-2 py-2.5 text-center transition-colors has-focus-visible:ring-2 has-focus-visible:ring-ink",
                    storage === option.value
                      ? "bg-surface shadow-[0_1px_3px_rgb(0_0_0/0.08)]"
                      : "hover:bg-surface/60",
                  )}
                >
                  <input
                    type="radio"
                    name="storage"
                    className="sr-only"
                    checked={storage === option.value}
                    onChange={() => setStorage(option.value)}
                  />
                  <span className="block text-[13px] font-medium">
                    {option.title}
                  </span>
                  <span className="block text-[11px] text-muted">
                    {option.note}
                  </span>
                </label>
              ))}
            </div>
          </fieldset>

          <Button
            type="submit"
            className="h-12 w-full text-[15px]"
            disabled={pending || !rootKey.trim()}
          >
            {pending ? (
              <IconLoader2 className="size-4 animate-spin" />
            ) : (
              <>
                Sign in
                <IconArrowRight className="size-4" />
              </>
            )}
          </Button>
        </form>
      </div>

      <nav
        className="flex items-center gap-5 text-sm text-muted"
        aria-label="Help"
      >
        <a
          href={docs.home}
          target="_blank"
          rel="noreferrer"
          className="hover:text-ink"
        >
          Documentation
        </a>
        <a
          href="/openapi"
          target="_blank"
          rel="noreferrer"
          className="hover:text-ink"
        >
          API reference
        </a>
        <a
          href={docs.configuration}
          target="_blank"
          rel="noreferrer"
          className="hover:text-ink"
        >
          Configuration
        </a>
      </nav>
    </div>
  );
};
