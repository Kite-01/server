import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { request, setRootKey, setUnauthorizedHandler } from "./api";

export type KeyStorage = "memory" | "session" | "local";

const StorageKey = "kite.rootKey";

type Session = {
  status: "loading" | "signed-out" | "signed-in";
  storage: KeyStorage;
  signIn: (rootKey: string, storage: KeyStorage) => Promise<void>;
  signOut: () => void;
};

const SessionContext = createContext<Session | null>(null);

const storageFor = (kind: KeyStorage) =>
  kind === "local" ? localStorage : kind === "session" ? sessionStorage : null;

const clearStored = () => {
  localStorage.removeItem(StorageKey);
  sessionStorage.removeItem(StorageKey);
};

export const SessionProvider = ({ children }: { children: ReactNode }) => {
  const [status, setStatus] = useState<Session["status"]>("loading");
  const [storage, setStorage] = useState<KeyStorage>("memory");

  const signOut = useCallback(() => {
    clearStored();
    setRootKey(null);
    setStorage("memory");
    setStatus("signed-out");
  }, []);

  const signIn = useCallback(async (rootKey: string, kind: KeyStorage) => {
    setRootKey(rootKey.trim());

    try {
      await request("GET", "/api/admin/system");
    } catch (error) {
      setRootKey(null);
      throw error;
    }

    clearStored();
    storageFor(kind)?.setItem(StorageKey, rootKey.trim());
    setStorage(kind);
    setStatus("signed-in");
  }, []);

  useEffect(() => {
    setUnauthorizedHandler(signOut);
    return () => setUnauthorizedHandler(null);
  }, [signOut]);

  useEffect(() => {
    const restore = async () => {
      const kind: KeyStorage = localStorage.getItem(StorageKey)
        ? "local"
        : sessionStorage.getItem(StorageKey)
          ? "session"
          : "memory";
      const stored = storageFor(kind)?.getItem(StorageKey);

      if (!stored) return setStatus("signed-out");

      try {
        await signIn(stored, kind);
      } catch {
        signOut();
      }
    };

    void restore();
  }, [signIn, signOut]);

  const value = useMemo(
    () => ({ status, storage, signIn, signOut }),
    [status, storage, signIn, signOut],
  );

  return (
    <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
  );
};

export const useSession = () => {
  const context = useContext(SessionContext);
  if (!context)
    throw new Error("useSession must be used inside SessionProvider");
  return context;
};
