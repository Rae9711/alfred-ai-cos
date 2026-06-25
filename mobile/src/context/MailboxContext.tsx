// Live Gmail inbox: sync on connect, pull-to-refresh, shared across Inbox + workflow.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { api } from "@/api/client";
import { useAuth } from "@/api/AuthContext";
import { registerForPush } from "@/api/push";
import { useMailAutoSync } from "@/hooks/useMailAutoSync";
import { type AppInboxItem, mapInboxMessage } from "@/lib/inbox";

export type InboxScope = "unread" | "today" | "synced";
export type InboxFilter = "inbox" | "unread" | "today" | string;

type MailboxState = {
  items: AppInboxItem[];
  mailboxes: string[];
  inboxScope: InboxScope;
  inboxMailbox: string | undefined;
  loading: boolean;
  syncing: boolean;
  error: string | null;
  lastSyncedAt: Date | null;
  setInboxFilter: (filter: InboxFilter) => Promise<void>;
  refresh: () => Promise<void>;
  syncAndRefresh: () => Promise<void>;
  markRead: (id: string) => Promise<void>;
  itemById: (id: string) => AppInboxItem | undefined;
};

const MailboxContext = createContext<MailboxState | null>(null);

export function MailboxProvider({ children }: { children: ReactNode }) {
  const { authed } = useAuth();
  const [items, setItems] = useState<AppInboxItem[]>([]);
  const [mailboxes, setMailboxes] = useState<string[]>([]);
  const [inboxScope, setInboxScope] = useState<InboxScope>("synced");
  const [inboxMailbox, setInboxMailbox] = useState<string | undefined>();
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastSyncedAt, setLastSyncedAt] = useState<Date | null>(null);
  const filterRef = useRef<{ scope: InboxScope; mailbox?: string }>({
    scope: "synced",
  });

  const loadInbox = useCallback(
    async (scope: InboxScope, mailbox?: string) => {
      const view = await api.getInbox({
        scope,
        mailbox: scope === "synced" ? mailbox : undefined,
      });
      setItems(view.messages.map(mapInboxMessage));
      setMailboxes(view.mailboxes ?? []);
      setInboxScope(scope);
      setInboxMailbox(mailbox);
      filterRef.current = { scope, mailbox };
    },
    [],
  );

  const setInboxFilter = useCallback(
    async (filter: InboxFilter) => {
      setError(null);
      try {
        if (filter === "inbox") {
          await loadInbox("synced");
        } else if (filter === "unread") {
          await loadInbox("unread");
        } else if (filter === "today") {
          await loadInbox("today");
        } else {
          await loadInbox("synced", filter);
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : "Couldn't load inbox");
        throw e;
      }
    },
    [loadInbox],
  );

  const refresh = useCallback(async () => {
    const { scope, mailbox } = filterRef.current;
    setError(null);
    try {
      await loadInbox(scope, mailbox);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load inbox");
      throw e;
    }
  }, [loadInbox]);

  const syncAndRefresh = useCallback(async () => {
    const started = Date.now();
    setSyncing(true);
    setError(null);
    const { scope, mailbox } = filterRef.current;
    try {
      await loadInbox(scope, mailbox);
      await api.sync({ background: true });
      setLastSyncedAt(new Date());
      for (const delay of [3_000, 10_000, 20_000]) {
        setTimeout(() => {
          const current = filterRef.current;
          void loadInbox(current.scope, current.mailbox).catch(() => undefined);
        }, delay);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Sync failed");
      throw e;
    } finally {
      const minSpinnerMs = 800;
      const wait = Math.max(0, minSpinnerMs - (Date.now() - started));
      setTimeout(() => setSyncing(false), wait);
    }
  }, [loadInbox]);

  const markRead = useCallback(async (id: string) => {
    await api.markMessageRead(id);
    setItems((prev) => {
      if (filterRef.current.scope === "unread") {
        return prev.filter((m) => m.id !== id);
      }
      return prev.map((m) => (m.id === id ? { ...m, isUnread: false } : m));
    });
  }, []);

  useEffect(() => {
    if (authed !== true) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        await loadInbox("synced");
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Couldn't load inbox");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
      void api.sync({ background: true }).catch(() => undefined);
    })();
    return () => {
      cancelled = true;
    };
  }, [authed, loadInbox]);

  useEffect(() => {
    if (authed !== true) return;
    void registerForPush().catch(() => undefined);
  }, [authed]);

  useMailAutoSync(syncAndRefresh);

  const itemById = useCallback(
    (id: string) => items.find((m) => m.id === id),
    [items],
  );

  const value = useMemo(
    () => ({
      items,
      mailboxes,
      inboxScope,
      inboxMailbox,
      loading,
      syncing,
      error,
      lastSyncedAt,
      setInboxFilter,
      refresh,
      syncAndRefresh,
      markRead,
      itemById,
    }),
    [
      items,
      mailboxes,
      inboxScope,
      inboxMailbox,
      loading,
      syncing,
      error,
      lastSyncedAt,
      setInboxFilter,
      refresh,
      syncAndRefresh,
      markRead,
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
