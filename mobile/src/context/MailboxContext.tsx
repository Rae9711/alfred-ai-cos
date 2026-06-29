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

export type InboxScope = "needs_action" | "unread" | "today" | "synced" | "sms";
export type InboxFilter = "needs_action" | "unread" | "sms" | "email" | string;

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
  syncAndRefresh: () => Promise<number>;
  markRead: (id: string) => Promise<boolean>;
  markDecided: (id: string) => Promise<void>;
  markUndecided: (id: string) => Promise<void>;
  itemById: (id: string) => AppInboxItem | undefined;
};

const MailboxContext = createContext<MailboxState | null>(null);

export function MailboxProvider({ children }: { children: ReactNode }) {
  const { authed } = useAuth();
  const [items, setItems] = useState<AppInboxItem[]>([]);
  const [mailboxes, setMailboxes] = useState<string[]>([]);
  const [inboxScope, setInboxScope] = useState<InboxScope>("needs_action");
  const [inboxMailbox, setInboxMailbox] = useState<string | undefined>();
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastSyncedAt, setLastSyncedAt] = useState<Date | null>(null);
  const filterRef = useRef<{ scope: InboxScope; mailbox?: string }>({
    scope: "needs_action",
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
        if (filter === "needs_action") {
          await loadInbox("needs_action");
        } else if (filter === "unread") {
          await loadInbox("unread");
        } else if (filter === "sms") {
          await loadInbox("sms");
        } else if (filter === "email") {
          await loadInbox("synced");
        } else {
          await loadInbox("synced");
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
    let ingested = 0;
    try {
      await loadInbox(scope, mailbox);
      const result = await api.sync({ ingestOnly: true });
      ingested = result.ingested;
      await loadInbox(scope, mailbox);
      setLastSyncedAt(new Date());
      if (ingested > 0) {
        setTimeout(() => {
          const current = filterRef.current;
          void loadInbox(current.scope, current.mailbox).catch(() => undefined);
        }, 5_000);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Sync failed");
      throw e;
    } finally {
      const minSpinnerMs = 800;
      const wait = Math.max(0, minSpinnerMs - (Date.now() - started));
      setTimeout(() => setSyncing(false), wait);
    }
    return ingested;
  }, [loadInbox]);

  const markDecided = useCallback(async (id: string) => {
    await api.markMessageDecided(id);
    setItems((prev) => {
      if (filterRef.current.scope === "needs_action") {
        return prev.filter((m) => m.id !== id);
      }
      return prev.map((m) =>
        m.id === id
          ? {
              ...m,
              section: "fyi" as const,
              category: "FYI",
              userDecided: true,
              showReplyActions: false,
              isUnread: false,
              tags: m.tags.map((t) =>
                t.label === "Needs Reply" || t.label === "Needs Decision"
                  ? { label: "FYI", tone: "muted" as const }
                  : t,
              ),
            }
          : m,
      );
    });
  }, []);

  const markUndecided = useCallback(async (id: string) => {
    await api.markMessageUndecided(id);
    const { scope } = filterRef.current;
    if (scope === "synced") {
      await loadInbox(scope, filterRef.current.mailbox);
      return;
    }
    setItems((prev) =>
      prev.map((m) => (m.id === id ? { ...m, userDecided: false } : m)),
    );
  }, [loadInbox]);

  const markRead = useCallback(async (id: string) => {
    const result = await api.markMessageRead(id);
    setItems((prev) => {
      if (filterRef.current.scope === "unread") {
        return prev.filter((m) => m.id !== id);
      }
      return prev.map((m) => (m.id === id ? { ...m, isUnread: false } : m));
    });
    return result.gmail_synced;
  }, []);

  useEffect(() => {
    if (authed !== true) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        await loadInbox("needs_action");
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
    // Provision SMS token on login so Shortcuts work before opening You tab.
    void api.getSmsForwarding().catch(() => undefined);
  }, [authed]);

  useMailAutoSync(async () => {
    await syncAndRefresh();
  });

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
      markDecided,
      markUndecided,
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
      markDecided,
      markUndecided,
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
