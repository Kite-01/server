import { useState, type FormEvent } from "react";
import { Logo } from "@/components/logo";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input, Label } from "@/components/ui/input";
import { useSession, type KeyStorage } from "@/lib/session";
import { toast } from "sonner";
import { IconChevronRight, IconLoader2 } from "@tabler/icons-react";

const options: { value: KeyStorage; title: string }[] = [
  { value: "memory", title: "Memory (most secure)" },
  { value: "session", title: "This browser session" },
  { value: "local", title: "This device (most persistent)" },
];

export const Login = () => {
  const { signIn } = useSession();
  const [rootKey, setRootKey] = useState("");
  const [storage, setStorage] = useState<KeyStorage>("session");
  const [open, setOpen] = useState(false);
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
    <div className="flex min-h-full items-center justify-center p-4">
      <Card className="w-full max-w-sm p-8">
        <Logo className="mb-6" hideLabel imgClassName="size-10" />
        <h1 className="text-2xl font-semibold tracking-tight">Sign in</h1>

        <form className="mt-6 space-y-5" onSubmit={submit}>
          <div className="space-y-1.5">
            <Label htmlFor="rootKey">Root key</Label>
            <Input
              id="rootKey"
              type="password"
              autoComplete="off"
              autoFocus
              value={rootKey}
              onChange={(event) => setRootKey(event.target.value)}
            />
          </div>

          <div className="rounded-xl border border-line">
            <button
              type="button"
              aria-expanded={open}
              aria-controls="remember-options"
              onClick={() => setOpen((value) => !value)}
              className="flex w-full cursor-pointer items-center gap-3 p-3 text-left"
            >
              <IconChevronRight
                className={`size-4 shrink-0 text-muted transition-transform duration-200 ${
                  open ? "rotate-90" : ""
                }`}
              />

              <span className="text-sm font-medium">Remember me</span>
            </button>

            {open && (
              <fieldset
                id="remember-options"
                className="space-y-2 border-t border-line p-3"
              >
                <legend className="sr-only">Remember me</legend>

                {options.map((option) => (
                  <label
                    key={option.value}
                    className="flex cursor-pointer items-center gap-3 p-1.5"
                  >
                    <input
                      type="radio"
                      name="storage"
                      className="accent-ink"
                      checked={storage === option.value}
                      onChange={() => setStorage(option.value)}
                    />

                    <span className="block text-sm">{option.title}</span>
                  </label>
                ))}
              </fieldset>
            )}
          </div>

          <Button
            type="submit"
            className="w-full"
            disabled={pending || !rootKey.trim()}
          >
            {pending ? (
              <IconLoader2 className="animate-spin size-4" />
            ) : (
              "Sign in"
            )}
          </Button>
        </form>
      </Card>
    </div>
  );
};
