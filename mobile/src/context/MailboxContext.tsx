// Live Gmail inbox: sync on connect, pull-to-refresh, shared across Inbox + workflow.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import { api } from "@/api/client";
import { useAuth } from "@/api/AuthContext";
import { type AppInboxItem, mapInboxMessage } from "@/lib/inbox";

type MailboxState = {
  items: AppInboxItem[];
  mailboxes: string[];
  loading: boolean;
  syncing: boolean;
  error: string | null;
  lastSyncedAt: Date | null;
  refresh: () => Promise<void>;
  syncAndRefresh: () => Promise<void>;
  itemById: (id: string) => AppInboxItem | undefined;
};

const MailboxContext = createContext<MailboxState | null>(null);

export function MailboxProvider({ children }: { children: ReactNode }) {
  const { authed } = useAuth();
  const [items, setItems] = useState<AppInboxItem[]>([]);
  const [mailboxes, setMailboxes] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastSyncedAt, setLastSyncedAt] = useState<Date | null>(null);

  const loadInbox = useCallback(async () => {
    const view = await api.getInbox();
    setItems(view.messages.map(mapInboxMessage));
    setMailboxes(view.mailboxes ?? []);
  }, []);

  const refresh = useCallback(async () => {
    setError(null);
    try {
      await loadInbox();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load inbox");
      throw e;
    }
  }, [loadInbox]);

  const syncAndRefresh = useCallback(async () => {
    setSyncing(true);
    setError(null);
    try {
      await api.sync();
      await loadInbox();
      setLastSyncedAt(new Date());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Sync failed");
      throw e;
    } finally {
      setSyncing(false);
    }
  }, [loadInbox]);

  useEffect(() => {
    if (authed !== true) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        await syncAndRefresh();
      } catch {
        // error state set in syncAndRefresh
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [authed, syncAndRefresh]);

  const itemById = useCallback(
    (id: string) => items.find((m) => m.id === id),
    [items],
  );

  const value = useMemo(
    () => ({
      items,
      mailboxes,
      loading,
      syncing,
      error,
      lastSyncedAt,
      refresh,
      syncAndRefresh,
      itemById,
    }),
    [
      items,
      mailboxes,
      loading,
      syncing,
      error,
      lastSyncedAt,
      refresh,
      syncAndRefresh,
      itemById,
    ],
  );

  return (
    <MailboxContext.Provider value={value}>{children}</MailboxContext.Provider>
  );
}

export function useMailbox(): MailboxState {
  const ctx = useContext(MailboxContext);
  if (!ctx) throw new Error("useMailbox must be used within MailboxProvider");
  return ctx;
}
