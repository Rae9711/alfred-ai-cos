// App-wide auth state. Holds whether a session token exists and exposes refresh/sign-out
// so screens and the tab guard react to login without prop drilling.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import { setOnAuthExpired } from "@/api/client";
import { clearToken, getToken } from "@/api/auth";

type AuthState = {
  authed: boolean | null; // null = still loading
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthCtx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [authed, setAuthed] = useState<boolean | null>(null);

  const refresh = useCallback(async () => {
    setAuthed(Boolean(await getToken()));
  }, []);

  const signOut = useCallback(async () => {
    await clearToken();
    setAuthed(false);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // When any API call hits a 401 (token expired/invalid/secret rotated), the client
  // clears the token and calls this — flip to unauthed so routing falls back to Connect.
  useEffect(() => {
    setOnAuthExpired(() => setAuthed(false));
    return () => setOnAuthExpired(null);
  }, []);

  const value = useMemo(
    () => ({ authed, refresh, signOut }),
    [authed, refresh, signOut],
  );
  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthCtx);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
