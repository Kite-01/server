import { useState, type FormEvent } from "react";
import { Logo } from "@/components/logo";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input, Label } from "@/components/ui/input";
import { useSession, type KeyStorage } from "@/lib/session";

const options: { value: KeyStorage; title: string; hint: string }[] = [
  {
    value: "memory",
    title: "Memory only",
    hint: "Most secure. The key is forgotten when this tab reloads or closes.",
  },
  {
    value: "session",
    title: "This browser session",
    hint: "Kept in session storage until the tab is closed.",
  },
  {
    value: "local",
    title: "This device",
    hint: "Most convenient. Kept in local storage until you sign out.",
  },
];

export const Login = () => {
  const { signIn } = useSession();
  const [rootKey, setRootKey] = useState("");
  const [storage, setStorage] = useState<KeyStorage>("memory");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setPending(true);
    setError(null);

    try {
      await signIn(rootKey, storage);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not sign in");
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="flex min-h-full items-center justify-center p-4">
      <Card className="w-full max-w-md p-8">
        <Logo className="mb-6" />
        <h1 className="text-xl font-semibold">Sign in with the root key</h1>
        <p className="mt-1 text-sm text-muted">
          Enter the server's KITE_ROOT_KEY. It is sent with every request as
          x-kite-root-key, so only use this dashboard over HTTPS.
        </p>

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

          <fieldset className="space-y-2">
            <legend className="mb-1 text-xs font-medium text-muted">
              Keep the key
            </legend>
            {options.map((option) => (
              <label
                key={option.value}
                className="flex cursor-pointer items-start gap-3 rounded-xl border border-line p-3 has-[:checked]:border-ink"
              >
                <input
                  type="radio"
                  name="storage"
                  className="mt-1 accent-ink"
                  checked={storage === option.value}
                  onChange={() => setStorage(option.value)}
                />
                <span>
                  <span className="block text-sm font-medium">
                    {option.title}
                  </span>
                  <span className="block text-xs text-muted">
                    {option.hint}
                  </span>
                </span>
              </label>
            ))}
          </fieldset>

          {error && <p className="text-sm text-danger">{error}</p>}

          <Button
            type="submit"
            className="w-full"
            disabled={pending || !rootKey.trim()}
          >
            {pending ? "Signing in…" : "Sign in"}
          </Button>
        </form>
      </Card>
    </div>
  );
};
