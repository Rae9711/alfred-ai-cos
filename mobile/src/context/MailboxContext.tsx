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
import {
  type AppInboxItem,
  type InboxApiScope,
  type InboxTabId,
  mapInboxMessage,
  scopeToTab,
  tabToScope,
} from "@/lib/inbox";
import { enrichInboxMessages } from "@/lib/smsSenderDisplay";

export type InboxScope = InboxApiScope | "today";
export type InboxFilter = InboxTabId | "email" | string;

export type InboxChipCounts = {
  all: number;
  needs_action: number;
  unread: number;
  sms: number;
};

const EMPTY_COUNTS: InboxChipCounts = {
  all: 0,
  needs_action: 0,
  unread: 0,
  sms: 0,
};

type MailboxState = {
  items: AppInboxItem[];
  mailboxes: string[];
  inboxScope: InboxApiScope;
  inboxFilter: InboxTabId;
  inboxMailbox: string | undefined;
  counts: InboxChipCounts;
  loading: boolean;
  tabLoading: boolean;
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

async function fetchScopeCount(scope: InboxApiScope): Promise<number> {
  try {
    const view = await api.getInbox({ scope });
    return view.messages.length;
  } catch {
    return 0;
  }
}

export function MailboxProvider({ children }: { children: ReactNode }) {
  const { authed } = useAuth();
  const [items, setItems] = useState<AppInboxItem[]>([]);
  const [mailboxes, setMailboxes] = useState<string[]>([]);
  const [inboxScope, setInboxScope] = useState<InboxApiScope>("needs_action");
  const [inboxFilter, setInboxFilterState] = useState<InboxTabId>("needs_action");
  const [inboxMailbox, setInboxMailbox] = useState<string | undefined>();
  const [counts, setCounts] = useState<InboxChipCounts>(EMPTY_COUNTS);
  const [loading, setLoading] = useState(true);
  const [tabLoading, setTabLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastSyncedAt, setLastSyncedAt] = useState<Date | null>(null);
  const filterRef = useRef<{ scope: InboxApiScope; mailbox?: string }>({
    scope: "needs_action",
  });
  const loadSeqRef = useRef(0);
  const countsSeqRef = useRef(0);

  const refreshCounts = useCallback(async () => {
    const seq = ++countsSeqRef.current;
    const [all, needs_action, unread, sms] = await Promise.all([
      fetchScopeCount("synced"),
      fetchScopeCount("needs_action"),
      fetchScopeCount("unread"),
      fetchScopeCount("sms"),
    ]);
    if (seq !== countsSeqRef.current) return;
    setCounts({ all, needs_action, unread, sms });
  }, []);

  const loadInbox = useCallback(
    async (scope: InboxApiScope, mailbox?: string) => {
      const seq = ++loadSeqRef.current;
      filterRef.current = { scope, mailbox };

      const view = await api.getInbox({
        scope,
        mailbox: scope === "synced" ? mailbox : undefined,
      });

      if (seq !== loadSeqRef.current) return;

      const mapped = view.messages.map(mapInboxMessage);
      const enriched = await enrichInboxMessages(mapped, view.messages);
      if (seq !== loadSeqRef.current) return;

      setItems(enriched);
      setMailboxes(view.mailboxes ?? []);
      setInboxScope(scope);
      setInboxFilterState(scopeToTab(scope));
      setInboxMailbox(mailbox);

      // Keep the active chip count in sync immediately; refresh the rest in background.
      setCounts((prev) => ({
        ...prev,
        [scope === "synced" ? "all" : scope]: enriched.length,
      }));
      void refreshCounts();
    },
    [refreshCounts],
  );

  const setInboxFilter = useCallback(
    async (filter: InboxFilter) => {
      const scope = tabToScope(filter);
      const tab = scopeToTab(scope);
      setInboxFilterState(tab);
      setTabLoading(true);
      setError(null);
      try {
        await loadInbox(scope);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Couldn't load inbox");
        throw e;
      } finally {
        setTabLoading(false);
      }
    },
    [loadInbox],
  );

  const refresh = useCallback(async () => {
    const { scope, mailbox } = filterRef.current;
    setError(null);
    setTabLoading(true);
    try {
      await loadInbox(scope, mailbox);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load inbox");
      throw e;
    } finally {
      setTabLoading(false);
    }
  }, [loadInbox]);

  const syncAndRefresh = useCallback(async () => {
    const started = Date.now();
    setSyncing(true);
    setError(null);
    const { scope, mailbox } = filterRef.current;
    const scopeAtStart = scope;
    const mailboxAtStart = mailbox;
    let ingested = 0;
    try {
      await loadInbox(scope, mailbox);
      const result = await api.sync({ ingestOnly: true });
      ingested = result.ingested;
      if (
        filterRef.current.scope === scopeAtStart &&
        filterRef.current.mailbox === mailboxAtStart
      ) {
        await loadInbox(scopeAtStart, mailboxAtStart);
      }
      setLastSyncedAt(new Date());
      if (ingested > 0) {
        setTimeout(() => {
          const current = filterRef.current;
          if (
            current.scope !== scopeAtStart ||
            current.mailbox !== mailboxAtStart
          ) {
            return;
          }
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
    setCounts((prev) => ({
      ...prev,
      needs_action: Math.max(0, prev.needs_action - 1),
    }));
    void refreshCounts();
  }, [refreshCounts]);

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
    void refreshCounts();
  }, [loadInbox, refreshCounts]);

  const markRead = useCallback(async (id: string) => {
    const result = await api.markMessageRead(id);
    setItems((prev) => {
      if (filterRef.current.scope === "unread") {
        return prev.filter((m) => m.id !== id);
      }
      return prev.map((m) => (m.id === id ? { ...m, isUnread: false } : m));
    });
    setCounts((prev) => ({
      ...prev,
      unread: Math.max(0, prev.unread - 1),
    }));
    void refreshCounts();
    return result.gmail_synced;
  }, [refreshCounts]);

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
      inboxFilter,
      inboxMailbox,
      counts,
      loading,
      tabLoading,
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
      inboxFilter,
      inboxMailbox,
      counts,
      loading,
      tabLoading,
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
