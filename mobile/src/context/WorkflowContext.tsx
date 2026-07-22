// Cross-tab workflow: Inbox → Chats (task thread) with real drafts + send.
// Alfred hub is the assistant tab; Chats empty path is paste-import.
// Task threads still load LLM drafts from the API.

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
import {
  setPendingAlfredLaunch,
  type AlfredLaunchOpts,
} from "@/lib/alfredLaunch";
import { enrichSmsDetailFields } from "@/lib/smsSenderDisplay";

export type { AlfredLaunchOpts };

/** Tab bar keys. `"ask"` is Chats (paste import / reply thread); `"alfred"` is the center hub. */
export type TabKey = "today" | "inbox" | "alfred" | "ask" | "settings";

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

export type OpenChatSeed = {
  source?: "email" | "sms";
  replyPhone?: string | null;
  sender?: string;
  title?: string;
  take?: string;
};

type WorkflowApi = {
  thread: WorkflowThread | null;
  openChatFromInbox: (
    messageId: string,
    mode: "reply" | "delegate",
    seed?: OpenChatSeed,
  ) => void;
  /** Opens Chats with a pre-filled short confirmation reply to an email thread. */
  openConfirmReply: (messageId: string, draftBody: string) => void;
  openChatFromHome: () => void;
  /**
   * Opens the Chats tab (formerly Ask free chat).
   * Optional message is consumed once Chats/Ask thread UI mounts.
   * SMS compose from Home should use `openAlfred` instead (redirects-i18n).
   */
  openFreeChat: (initialMessage?: string) => void;
  /** Opens the Alfred hub tab (schedule / SMS / reminder / capture). */
  openAlfred: (opts?: AlfredLaunchOpts) => void;
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
    async (
      messageId: string,
      mode: "reply" | "delegate",
      tone = "concise",
      seed?: OpenChatSeed,
    ) => {
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
          to: seed?.sender ?? item?.sender ?? "Contact",
          subject: d.subject ?? `Re: ${seed?.title ?? item?.title ?? ""}`,
          body: d.body,
        },
        draftId: d.id,
      };
    },
    [itemById],
  );

  const openChatFromInbox = useCallback(
    (messageId: string, mode: "reply" | "delegate", seed?: OpenChatSeed) => {
      const item = itemById(messageId);
      const sender = seed?.sender ?? item?.sender ?? "Contact";
      const title = seed?.title ?? item?.title ?? "Message";
      const take = seed?.take ?? item?.take ?? null;
      const source = seed?.source ?? item?.source ?? "email";
      const replyPhone = seed?.replyPhone ?? item?.replyPhone ?? null;
      setThread({
        messageId,
        source,
        replyPhone,
        sender,
        subject: title,
        summary: take || null,
        body: "",
        bodyLoading: true,
        bodyError: null,
        mode,
        draft: { to: sender, subject: "", body: "" },
        draftId: null,
        draftLoading: true,
        draftError: null,
        revisionHistory: [],
      });
      setTab("ask");
      void (async () => {
        const detailPromise = api.getMessage(messageId);
        const draftPromise = loadDraft(messageId, mode, "concise", seed);

        const [detailResult, draftResult] = await Promise.allSettled([
          detailPromise,
          draftPromise,
        ]);

        if (detailResult.status === "fulfilled") {
          const detail = detailResult.value;
          const enriched = await enrichSmsDetailFields(detail, {
            preferSender: sender,
          });
          setThread((current) =>
            current?.messageId === messageId
              ? {
                  ...current,
                  source: detail.source === "sms" ? "sms" : "email",
                  replyPhone: enriched.replyPhone || current.replyPhone,
                  sender: enriched.sender,
                  subject:
                    detail.source === "sms"
                      ? enriched.subject
                      : detail.subject?.trim() || current.subject,
                  summary: enriched.summary || current.summary,
                  body: enriched.body,
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

  const openConfirmReply = useCallback(
    (messageId: string, draftBody: string) => {
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
        mode: "reply",
        draft: {
          to: item?.sender ?? "",
          subject: item?.title ? `Re: ${item.title}` : "Re:",
          body: draftBody,
        },
        draftId: null,
        draftLoading: false,
        draftError: null,
        revisionHistory: [],
      });
      setTab("ask");
      void (async () => {
        try {
          const detail = await api.getMessage(messageId);
          const enriched = await enrichSmsDetailFields(detail, {
            preferSender: item?.sender,
          });
          setThread((current) =>
            current?.messageId === messageId
              ? {
                  ...current,
                  source: detail.source === "sms" ? "sms" : "email",
                  replyPhone: enriched.replyPhone || current.replyPhone,
                  sender: enriched.sender,
                  subject:
                    detail.source === "sms"
                      ? enriched.subject
                      : detail.subject?.trim()
                        ? `Re: ${detail.subject.trim()}`
                        : current.draft.subject,
                  summary: enriched.summary || current.summary,
                  body: enriched.body,
                  bodyLoading: false,
                }
              : current,
          );
        } catch (e) {
          const message =
            e instanceof Error ? e.message : "Couldn't load email";
          setThread((current) =>
            current?.messageId === messageId
              ? { ...current, bodyLoading: false, bodyError: message }
              : current,
          );
        }
      })();
    },
    [setTab, itemById],
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

  const openAlfred = useCallback(
    (opts?: AlfredLaunchOpts) => {
      if (opts && (opts.capture || opts.text || opts.mode || opts.seed)) {
        setPendingAlfredLaunch(opts);
      }
      setTab("alfred");
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
      openConfirmReply,
      openChatFromHome,
      openFreeChat,
      openAlfred,
      consumePendingFreeChatMessage,
      completeChat,
      cancelChat,
      reviseDraft,
      setTab,
    }),
    [
      thread,
      openChatFromInbox,
      openConfirmReply,
      openChatFromHome,
      openFreeChat,
      openAlfred,
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
