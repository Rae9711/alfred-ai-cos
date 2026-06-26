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
  source: "email" | "sms";
  replyPhone: string | null;
  sender: string;
  subject: string;
  summary: string | null;
  body: string;
  bodyLoading: boolean;
  bodyError: string | null;
  mode: ChatMode;
  draft: WorkflowDraft;
  draftId: string | null;
  draftLoading: boolean;
  draftError: string | null;
  revisionHistory: string[];
};

type WorkflowApi = {
  thread: WorkflowThread | null;
  openChatFromInbox: (messageId: string, mode: "reply" | "delegate") => void;
  openChatFromHome: () => void;
  /** Opens Ask free chat; optional message is sent once the screen mounts. */
  openFreeChat: (initialMessage?: string) => void;
  consumePendingFreeChatMessage: () => string | null;
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
  const [pendingFreeChatMessage, setPendingFreeChatMessage] = useState<
    string | null
  >(null);
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
        source: item?.source ?? "email",
        replyPhone: item?.replyPhone ?? null,
        sender: item?.sender ?? "Contact",
        subject: item?.title ?? "Message",
        summary: item?.take || null,
        body: "",
        bodyLoading: true,
        bodyError: null,
        mode,
        draft: { to: item?.sender ?? "", subject: "", body: "" },
        draftId: null,
        draftLoading: true,
        draftError: null,
        revisionHistory: [],
      });
      setTab("ask");
      void (async () => {
        const detailPromise = api.getMessage(messageId);
        const draftPromise = loadDraft(messageId, mode);

        const [detailResult, draftResult] = await Promise.allSettled([
          detailPromise,
          draftPromise,
        ]);

        if (detailResult.status === "fulfilled") {
          const detail = detailResult.value;
          setThread((current) =>
            current?.messageId === messageId
              ? {
                  ...current,
                  source: detail.source === "sms" ? "sms" : "email",
                  replyPhone: detail.reply_phone?.trim() || current.replyPhone,
                  sender: detail.sender,
                  subject: detail.subject?.trim() || current.subject,
                  summary: detail.take?.trim() || current.summary,
                  body: detail.body,
                  bodyLoading: false,
                }
              : current,
          );
        } else {
          const message =
            detailResult.reason instanceof Error
              ? detailResult.reason.message
              : "Couldn't load email";
          setThread((current) =>
            current?.messageId === messageId
              ? { ...current, bodyLoading: false, bodyError: message }
              : current,
          );
        }

        if (draftResult.status === "fulfilled") {
          const { draft, draftId } = draftResult.value;
          setThread((current) =>
            current?.messageId === messageId
              ? { ...current, draft, draftId, draftLoading: false }
              : current,
          );
        } else {
          const message =
            draftResult.reason instanceof Error
              ? draftResult.reason.message
              : "Couldn't draft reply";
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
      source: "email",
      replyPhone: null,
      sender: p.sender,
      subject: p.subject,
      summary: null,
      body: "",
      bodyLoading: false,
      bodyError: null,
      mode: "proactive",
      draft: draftForMessage(p.messageId, locale),
      draftId: null,
      draftLoading: false,
      draftError: null,
      revisionHistory: [],
    });
    setTab("ask");
  }, [setTab, locale]);

  const openFreeChat = useCallback(
    (initialMessage?: string) => {
      setThread(null);
      if (initialMessage?.trim()) {
        setPendingFreeChatMessage(initialMessage.trim());
      }
      setTab("ask");
    },
    [setTab],
  );

  const consumePendingFreeChatMessage = useCallback(() => {
    const msg = pendingFreeChatMessage;
    setPendingFreeChatMessage(null);
    return msg;
  }, [pendingFreeChatMessage]);

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
          current_draft_body: thread.draft.body || null,
          revision_history: thread.revisionHistory,
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
                revisionHistory: [...t.revisionHistory, trimmed],
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
      consumePendingFreeChatMessage,
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
      consumePendingFreeChatMessage,
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
