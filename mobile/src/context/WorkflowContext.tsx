// Cross-tab workflow: Inbox → Chat (task thread) with real drafts + send.
// Free chat stays on AskScreen; task threads load LLM drafts from the API.

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import { api } from "@/api/client";
import { useLocale } from "@/context/LocaleContext";
import { useMailbox } from "@/context/MailboxContext";
import {
  draftForMessage,
  getWorkflowProactive,
  type WorkflowDraft,
} from "@/data/workflowDemo";

export type TabKey = "today" | "inbox" | "ask" | "settings";

export type ChatMode = "free" | "reply" | "delegate" | "proactive";

export type WorkflowThread = {
  messageId: string;
  sender: string;
  subject: string;
  mode: ChatMode;
  draft: WorkflowDraft;
  draftId: string | null;
  draftLoading: boolean;
  draftError: string | null;
};

type WorkflowApi = {
  thread: WorkflowThread | null;
  openChatFromInbox: (messageId: string, mode: "reply" | "delegate") => void;
  openChatFromHome: () => void;
  openFreeChat: () => void;
  completeChat: () => void;
  cancelChat: () => void;
  reviseDraft: (instruction: string) => Promise<void>;
};

const WorkflowContext = createContext<
  (WorkflowApi & { setTab: (tab: TabKey) => void }) | null
>(null);

export function WorkflowProvider({
  children,
  setTab,
}: {
  children: ReactNode;
  setTab: (tab: TabKey) => void;
}) {
  const [thread, setThread] = useState<WorkflowThread | null>(null);
  const { locale } = useLocale();
  const { itemById } = useMailbox();

  const loadDraft = useCallback(
    async (messageId: string, mode: "reply" | "delegate", tone = "concise") => {
      const instruction =
        mode === "delegate"
          ? "Draft a clear, polite reply on my behalf."
          : undefined;
      const d = await api.createDraft({
        message_id: messageId,
        tone,
        instruction,
      });
      const item = itemById(messageId);
      return {
        draft: {
          to: item?.sender ?? "Contact",
          subject: d.subject ?? `Re: ${item?.title ?? ""}`,
          body: d.body,
        },
        draftId: d.id,
      };
    },
    [itemById],
  );

  const openChatFromInbox = useCallback(
    (messageId: string, mode: "reply" | "delegate") => {
      const item = itemById(messageId);
      setThread({
        messageId,
        sender: item?.sender ?? "Contact",
        subject: item?.title ?? "Message",
        mode,
        draft: { to: item?.sender ?? "", subject: "", body: "" },
        draftId: null,
        draftLoading: true,
        draftError: null,
      });
      setTab("ask");
      void (async () => {
        try {
          const { draft, draftId } = await loadDraft(messageId, mode);
          setThread((current) =>
            current?.messageId === messageId
              ? { ...current, draft, draftId, draftLoading: false }
              : current,
          );
        } catch (e) {
          const message = e instanceof Error ? e.message : "Couldn't draft reply";
          setThread((current) =>
            current?.messageId === messageId
              ? { ...current, draftLoading: false, draftError: message }
              : current,
          );
        }
      })();
    },
    [setTab, itemById, loadDraft],
  );

  const openChatFromHome = useCallback(() => {
    const p = getWorkflowProactive(locale);
    setThread({
      messageId: p.messageId,
      sender: p.sender,
      subject: p.subject,
      mode: "proactive",
      draft: draftForMessage(p.messageId, locale),
      draftId: null,
      draftLoading: false,
      draftError: null,
    });
    setTab("ask");
  }, [setTab, locale]);

  const openFreeChat = useCallback(() => {
    setThread(null);
    setTab("ask");
  }, [setTab]);

  const finish = useCallback(() => {
    setThread(null);
    setTab("inbox");
  }, [setTab]);

  const completeChat = useCallback(() => {
    finish();
  }, [finish]);

  const cancelChat = useCallback(() => {
    finish();
  }, [finish]);

  const reviseDraft = useCallback(
    async (instruction: string) => {
      const trimmed = instruction.trim();
      if (!trimmed || !thread) return;
      setThread((t) =>
        t ? { ...t, draftLoading: true, draftError: null } : t,
      );
      try {
        const d = await api.createDraft({
          message_id: thread.messageId,
          tone: "concise",
          instruction: trimmed,
        });
        setThread((t) =>
          t
            ? {
                ...t,
                draft: {
                  ...t.draft,
                  subject: d.subject ?? t.draft.subject,
                  body: d.body,
                },
                draftId: d.id,
                draftLoading: false,
              }
            : t,
        );
      } catch (e) {
        setThread((t) =>
          t
            ? {
                ...t,
                draftLoading: false,
                draftError:
                  e instanceof Error ? e.message : "Couldn't revise draft",
              }
            : t,
        );
        throw e;
      }
    },
    [thread],
  );

  const value = useMemo(
    () => ({
      thread,
      openChatFromInbox,
      openChatFromHome,
      openFreeChat,
      completeChat,
      cancelChat,
      reviseDraft,
      setTab,
    }),
    [
      thread,
      openChatFromInbox,
      openChatFromHome,
      openFreeChat,
      completeChat,
      cancelChat,
      reviseDraft,
      setTab,
    ],
  );

  return (
    <WorkflowContext.Provider value={value}>{children}</WorkflowContext.Provider>
  );
}

export function useWorkflow(): WorkflowApi & { setTab: (tab: TabKey) => void } {
  const ctx = useContext(WorkflowContext);
  if (!ctx) {
    throw new Error("useWorkflow must be used within <WorkflowProvider>");
  }
  return ctx;
}
