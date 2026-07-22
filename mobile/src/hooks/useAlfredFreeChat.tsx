/**
 * Free-chat composer for Alfred hub: calendar/ask via api.chat, SMS + email compose.
 * Migrated from AskScreen's free-chat path (task threads stay on Ask/Chats).
 */

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type RefObject,
} from "react";
import { AppState, type ScrollView } from "react-native";

import { api } from "@/api/client";
import { useCompanionAvatar } from "@/context/CompanionAvatarContext";
import { useLocale } from "@/context/LocaleContext";
import { type ChatMessage } from "@/data/demo";
import { useShell } from "@/components/Shell";
import { EmailComposeSheet } from "@/screens/sheets/EmailComposeSheet";
import { SmsComposeSheet } from "@/screens/sheets/SmsComposeSheet";
import {
  pickAutoContact,
  requestContactsPermission,
  searchContactsByName,
  searchContactsEmailByName,
  type ContactMatch,
  type EmailContactMatch,
} from "@/lib/contacts";
import {
  normalizeEmailInput,
  parseEmailComposeIntent,
  parseEmailComposeStarter,
} from "@/lib/emailComposeIntent";
import {
  normalizePhoneInput,
  parseSmsComposeIntent,
  parseSmsComposeStarter,
} from "@/lib/smsComposeIntent";
import {
  hasPersistableFreeChatHistory,
  loadFreeChatHistoryWithRetry,
  saveFreeChatHistory,
  subscribeFreeChatCleared,
  type PersistedFreeMsg,
} from "@/lib/freeChatHistory";
import { scheduleFromAssistantResponse } from "@/lib/taskReminders";
import { useVoiceCapture } from "@/api/useVoiceCapture";

export type AlfredFreeMsg = ChatMessage & {
  smsDraft?: { name: string; phone: string; body: string };
  emailDraft?: {
    composeId: string;
    name: string;
    email: string;
    subject: string;
    body: string;
    sending?: boolean;
  };
};

type AwaitingSmsBody = { displayName: string; phone: string };
type AwaitingEmailBody = { displayName: string; email: string };
type AwaitingSmsPhone = { displayName: string; bodyHint: string | null };
type AwaitingEmailAddress = { displayName: string; bodyHint: string | null };
type AwaitingSmsRecipient = { bodyHint: string | null };
type AwaitingEmailRecipient = { bodyHint: string | null };

export function useAlfredFreeChat(scrollRef: RefObject<ScrollView | null>) {
  const { openSheet, showToast } = useShell();
  const { setThinking } = useCompanionAvatar();
  const { locale, t } = useLocale();

  const [freeChat, setFreeChat] = useState<AlfredFreeMsg[]>([]);
  const [freeChatHydrated, setFreeChatHydrated] = useState(false);
  const [input, setInput] = useState("");
  const [thinking, setThinkingLocal] = useState(false);
  const [awaitingSmsBody, setAwaitingSmsBody] = useState<AwaitingSmsBody | null>(
    null,
  );
  const [awaitingSmsPhone, setAwaitingSmsPhone] = useState<AwaitingSmsPhone | null>(
    null,
  );
  const [awaitingSmsRecipient, setAwaitingSmsRecipient] =
    useState<AwaitingSmsRecipient | null>(null);
  const [awaitingEmailBody, setAwaitingEmailBody] =
    useState<AwaitingEmailBody | null>(null);
  const [awaitingEmailAddress, setAwaitingEmailAddress] =
    useState<AwaitingEmailAddress | null>(null);
  const [awaitingEmailRecipient, setAwaitingEmailRecipient] =
    useState<AwaitingEmailRecipient | null>(null);

  const freeChatRef = useRef<AlfredFreeMsg[]>([]);
  const persistFreeChat = useCallback((messages: PersistedFreeMsg[]) => {
    if (!hasPersistableFreeChatHistory(messages)) return;
    void saveFreeChatHistory(messages);
  }, []);

  const seedMsg = useCallback(
    (): AlfredFreeMsg => ({ role: "alfred", text: t.alfredHub.seed, ts: "now" }),
    [t.alfredHub.seed],
  );

  const sendFreeRef = useRef<(text: string) => void>(() => undefined);

  const voice = useVoiceCapture((r) => {
    const q = r.tasks.map((task) => task.title).join("; ");
    if (q.trim()) sendFreeRef.current(q);
  });

  useEffect(() => {
    freeChatRef.current = freeChat;
  }, [freeChat]);

  useEffect(() => {
    let cancelled = false;
    const seed = t.alfredHub.seed;
    void (async () => {
      const stored = await loadFreeChatHistoryWithRetry();
      if (cancelled) return;
      setFreeChat(
        stored && stored.length > 0
          ? stored
          : [{ role: "alfred", text: seed, ts: "now" }],
      );
      setFreeChatHydrated(true);
    })();
    return () => {
      cancelled = true;
      persistFreeChat(freeChatRef.current);
    };
  }, [t.alfredHub.seed, persistFreeChat]);

  useEffect(() => {
    if (!freeChatHydrated) return;
    setFreeChat((c) => {
      if (c.length !== 1 || c[0]?.role !== "alfred") return c;
      return [seedMsg()];
    });
  }, [locale, seedMsg, freeChatHydrated]);

  useEffect(() => {
    if (!freeChatHydrated) return;
    persistFreeChat(freeChat);
  }, [freeChat, freeChatHydrated, persistFreeChat]);

  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "background" || state === "inactive") {
        persistFreeChat(freeChatRef.current);
      }
    });
    return () => sub.remove();
  }, [persistFreeChat]);

  useEffect(() => {
    return subscribeFreeChatCleared(() => {
      setFreeChat([seedMsg()]);
    });
  }, [seedMsg]);

  const setThinkingBoth = useCallback(
    (v: boolean) => {
      setThinkingLocal(v);
      setThinking(v);
    },
    [setThinking],
  );

  const appendSmsDraft = useCallback(
    (name: string, phone: string, body: string) => {
      setFreeChat((c) => [
        ...c,
        {
          role: "alfred",
          text: t.smsCompose.ready(name),
          ts: "now",
          smsDraft: { name, phone, body },
        },
      ]);
      scrollRef.current?.scrollToEnd({ animated: true });
    },
    [scrollRef, t.smsCompose],
  );

  const draftEmail = useCallback(
    (displayName: string, email: string, intent: string) => {
      setThinkingBoth(true);
      setFreeChat((c) => [
        ...c,
        { role: "alfred", text: t.emailCompose.drafting, ts: "now" },
      ]);
      scrollRef.current?.scrollToEnd({ animated: true });
      void (async () => {
        try {
          const draft = await api.composeDraft({
            recipient_email: email,
            recipient_name: displayName,
            intent,
          });
          setFreeChat((c) => {
            const withoutDrafting = c.filter(
              (m) => !(m.role === "alfred" && m.text === t.emailCompose.drafting),
            );
            return [
              ...withoutDrafting,
              {
                role: "alfred",
                text: t.emailCompose.ready(displayName),
                ts: "now",
                emailDraft: {
                  composeId: draft.id,
                  name: displayName,
                  email: draft.recipient_email,
                  subject: draft.subject,
                  body: draft.body,
                },
              },
            ];
          });
        } catch (e) {
          setFreeChat((c) => {
            const withoutDrafting = c.filter(
              (m) => !(m.role === "alfred" && m.text === t.emailCompose.drafting),
            );
            return [
              ...withoutDrafting,
              {
                role: "alfred",
                text: e instanceof Error ? e.message : t.freeChat.fallback,
                ts: "now",
              },
            ];
          });
        } finally {
          setThinkingBoth(false);
          scrollRef.current?.scrollToEnd({ animated: true });
        }
      })();
    },
    [scrollRef, setThinkingBoth, t.emailCompose, t.freeChat.fallback],
  );

  const resolveEmailRecipient = useCallback(
    (displayName: string, email: string, bodyHint: string | null) => {
      setFreeChat((c) => [
        ...c,
        {
          role: "alfred",
          text: t.emailCompose.foundContact(displayName, email),
          ts: "now",
        },
      ]);
      scrollRef.current?.scrollToEnd({ animated: true });
      if (bodyHint) {
        draftEmail(displayName, email, bodyHint);
        return;
      }
      setAwaitingEmailBody({ displayName, email });
      setFreeChat((c) => [
        ...c,
        { role: "alfred", text: t.emailCompose.askBody(displayName), ts: "now" },
      ]);
      scrollRef.current?.scrollToEnd({ animated: true });
    },
    [draftEmail, scrollRef, t.emailCompose],
  );

  const startEmailCompose = useCallback(
    (recipientName: string, bodyHint: string | null) => {
      setThinkingBoth(true);
      scrollRef.current?.scrollToEnd({ animated: true });
      void (async () => {
        try {
          const granted = await requestContactsPermission();
          if (!granted) {
            setFreeChat((c) => [
              ...c,
              { role: "alfred", text: t.emailCompose.permissionDenied, ts: "now" },
            ]);
            return;
          }
          const matches = await searchContactsEmailByName(recipientName);
          const auto = pickAutoContact(matches);
          if (auto) {
            resolveEmailRecipient(auto.name, auto.email, bodyHint);
            return;
          }
          if (matches.length === 0) {
            setAwaitingEmailAddress({ displayName: recipientName, bodyHint });
            setFreeChat((c) => [
              ...c,
              {
                role: "alfred",
                text: t.emailCompose.askEmail(recipientName),
                ts: "now",
              },
            ]);
            return;
          }
          setFreeChat((c) => [
            ...c,
            { role: "alfred", text: t.emailCompose.pickContact, ts: "now" },
          ]);
          openSheet(
            <EmailComposeSheet
              mode="pick"
              matches={matches}
              onSelect={(m: EmailContactMatch) =>
                resolveEmailRecipient(m.name, m.email, bodyHint)
              }
            />,
          );
        } catch (e) {
          setFreeChat((c) => [
            ...c,
            {
              role: "alfred",
              text: e instanceof Error ? e.message : t.freeChat.fallback,
              ts: "now",
            },
          ]);
        } finally {
          setThinkingBoth(false);
          scrollRef.current?.scrollToEnd({ animated: true });
        }
      })();
    },
    [
      openSheet,
      resolveEmailRecipient,
      scrollRef,
      setThinkingBoth,
      t.emailCompose,
      t.freeChat.fallback,
    ],
  );

  const sendEmailDraft = useCallback(
    (composeId: string) => {
      setFreeChat((c) =>
        c.map((m) =>
          m.emailDraft?.composeId === composeId
            ? { ...m, emailDraft: { ...m.emailDraft, sending: true } }
            : m,
        ),
      );
      void (async () => {
        try {
          const proposal = await api.proposeSendCompose(composeId);
          await api.approveAction(proposal.id);
          showToast(t.emailCompose.sent);
          setFreeChat((c) =>
            c.map((m) =>
              m.emailDraft?.composeId === composeId
                ? {
                    ...m,
                    text: t.emailCompose.sent,
                    emailDraft: { ...m.emailDraft, sending: false },
                  }
                : m,
            ),
          );
        } catch (e) {
          showToast(
            e instanceof Error ? e.message : t.emailCompose.sendFailed,
          );
          setFreeChat((c) =>
            c.map((m) =>
              m.emailDraft?.composeId === composeId
                ? { ...m, emailDraft: { ...m.emailDraft, sending: false } }
                : m,
            ),
          );
        }
      })();
    },
    [showToast, t.emailCompose],
  );

  const resolveSmsRecipient = useCallback(
    (displayName: string, phone: string, bodyHint: string | null) => {
      setFreeChat((c) => [
        ...c,
        {
          role: "alfred",
          text: t.smsCompose.foundContact(displayName, phone),
          ts: "now",
        },
      ]);
      scrollRef.current?.scrollToEnd({ animated: true });
      if (bodyHint) {
        appendSmsDraft(displayName, phone, bodyHint);
        return;
      }
      setAwaitingSmsBody({ displayName, phone });
      setFreeChat((c) => [
        ...c,
        { role: "alfred", text: t.smsCompose.askBody(displayName), ts: "now" },
      ]);
      scrollRef.current?.scrollToEnd({ animated: true });
    },
    [appendSmsDraft, scrollRef, t.smsCompose],
  );

  const startSmsCompose = useCallback(
    (recipientName: string, bodyHint: string | null) => {
      setThinkingBoth(true);
      scrollRef.current?.scrollToEnd({ animated: true });
      void (async () => {
        try {
          const granted = await requestContactsPermission();
          if (!granted) {
            setFreeChat((c) => [
              ...c,
              { role: "alfred", text: t.smsCompose.permissionDenied, ts: "now" },
            ]);
            return;
          }
          const matches = await searchContactsByName(recipientName);
          const auto = pickAutoContact(matches);
          if (auto) {
            resolveSmsRecipient(auto.name, auto.phone, bodyHint);
            return;
          }
          if (matches.length === 0) {
            setAwaitingSmsPhone({ displayName: recipientName, bodyHint });
            setFreeChat((c) => [
              ...c,
              {
                role: "alfred",
                text: t.smsCompose.askPhone(recipientName),
                ts: "now",
              },
            ]);
            return;
          }
          setFreeChat((c) => [
            ...c,
            { role: "alfred", text: t.smsCompose.pickContact, ts: "now" },
          ]);
          openSheet(
            <SmsComposeSheet
              mode="pick"
              matches={matches}
              onSelect={(m: ContactMatch) =>
                resolveSmsRecipient(m.name, m.phone, bodyHint)
              }
            />,
          );
        } catch (e) {
          setFreeChat((c) => [
            ...c,
            {
              role: "alfred",
              text: e instanceof Error ? e.message : t.freeChat.fallback,
              ts: "now",
            },
          ]);
        } finally {
          setThinkingBoth(false);
          scrollRef.current?.scrollToEnd({ animated: true });
        }
      })();
    },
    [
      openSheet,
      resolveSmsRecipient,
      scrollRef,
      setThinkingBoth,
      t.freeChat.fallback,
      t.smsCompose,
    ],
  );

  const sendFree = useCallback(
    (text: string) => {
      const q = text.trim();
      if (!q || thinking) return;
      setFreeChat((c) => [...c, { role: "user", text: q, ts: "now" }]);
      setInput("");
      scrollRef.current?.scrollToEnd({ animated: true });

      if (awaitingSmsBody) {
        const { displayName, phone } = awaitingSmsBody;
        setAwaitingSmsBody(null);
        appendSmsDraft(displayName, phone, q);
        return;
      }

      if (awaitingEmailBody) {
        const { displayName, email } = awaitingEmailBody;
        setAwaitingEmailBody(null);
        draftEmail(displayName, email, q);
        return;
      }

      if (awaitingSmsPhone) {
        const phone = normalizePhoneInput(q);
        if (!phone) {
          setFreeChat((c) => [
            ...c,
            { role: "alfred", text: t.smsCompose.askPhoneInvalid, ts: "now" },
          ]);
          scrollRef.current?.scrollToEnd({ animated: true });
          return;
        }
        const { displayName, bodyHint } = awaitingSmsPhone;
        setAwaitingSmsPhone(null);
        resolveSmsRecipient(displayName, phone, bodyHint);
        return;
      }

      if (awaitingEmailAddress) {
        const email = normalizeEmailInput(q);
        if (!email) {
          setFreeChat((c) => [
            ...c,
            { role: "alfred", text: t.emailCompose.askEmailInvalid, ts: "now" },
          ]);
          scrollRef.current?.scrollToEnd({ animated: true });
          return;
        }
        const { displayName, bodyHint } = awaitingEmailAddress;
        setAwaitingEmailAddress(null);
        resolveEmailRecipient(displayName, email, bodyHint);
        return;
      }

      if (awaitingSmsRecipient) {
        const { bodyHint } = awaitingSmsRecipient;
        setAwaitingSmsRecipient(null);
        const reparsed = parseSmsComposeIntent(q);
        if (reparsed) {
          startSmsCompose(reparsed.recipientName, reparsed.bodyHint ?? bodyHint);
          return;
        }
        startSmsCompose(q, bodyHint);
        return;
      }

      if (awaitingEmailRecipient) {
        const { bodyHint } = awaitingEmailRecipient;
        setAwaitingEmailRecipient(null);
        const reparsed = parseEmailComposeIntent(q);
        if (reparsed) {
          startEmailCompose(
            reparsed.recipientName,
            reparsed.bodyHint ?? bodyHint,
          );
          return;
        }
        startEmailCompose(q, bodyHint);
        return;
      }

      const emailIntent = parseEmailComposeIntent(q);
      if (emailIntent) {
        startEmailCompose(emailIntent.recipientName, emailIntent.bodyHint);
        return;
      }

      if (parseEmailComposeStarter(q)) {
        setAwaitingEmailRecipient({ bodyHint: null });
        setFreeChat((c) => [
          ...c,
          { role: "alfred", text: t.emailCompose.askWho, ts: "now" },
        ]);
        scrollRef.current?.scrollToEnd({ animated: true });
        return;
      }

      const smsIntent = parseSmsComposeIntent(q);
      if (smsIntent) {
        startSmsCompose(smsIntent.recipientName, smsIntent.bodyHint);
        return;
      }

      if (parseSmsComposeStarter(q)) {
        setAwaitingSmsRecipient({ bodyHint: null });
        setFreeChat((c) => [
          ...c,
          { role: "alfred", text: t.smsCompose.askWho, ts: "now" },
        ]);
        scrollRef.current?.scrollToEnd({ animated: true });
        return;
      }

      setThinkingBoth(true);
      void (async () => {
        try {
          const history = freeChat
            .filter((m) => m.ts !== "now" || m.role === "user")
            .slice(-8)
            .map((m) => ({
              role: m.role === "user" ? "user" : "assistant",
              content: m.text,
            }));
          const res = await api.chat(q, history);
          await scheduleFromAssistantResponse(res);
          setFreeChat((c) => [
            ...c,
            { role: "alfred", text: res.reply, ts: "now" },
          ]);
        } catch {
          setFreeChat((c) => [
            ...c,
            { role: "alfred", text: t.freeChat.fallback, ts: "now" },
          ]);
        } finally {
          setThinkingBoth(false);
          scrollRef.current?.scrollToEnd({ animated: true });
        }
      })();
    },
    [
      appendSmsDraft,
      awaitingEmailAddress,
      awaitingEmailBody,
      awaitingEmailRecipient,
      awaitingSmsBody,
      awaitingSmsPhone,
      awaitingSmsRecipient,
      draftEmail,
      freeChat,
      resolveEmailRecipient,
      resolveSmsRecipient,
      scrollRef,
      startEmailCompose,
      startSmsCompose,
      thinking,
      setThinkingBoth,
      t.emailCompose,
      t.freeChat.fallback,
      t.smsCompose,
    ],
  );

  sendFreeRef.current = sendFree;

  const beginSmsFlow = useCallback(() => {
    setAwaitingSmsRecipient({ bodyHint: null });
    setFreeChat((c) => [
      ...c,
      { role: "alfred", text: t.smsCompose.askWho, ts: "now" },
    ]);
    scrollRef.current?.scrollToEnd({ animated: true });
  }, [scrollRef, t.smsCompose.askWho]);

  const beginEmailFlow = useCallback(() => {
    setAwaitingEmailRecipient({ bodyHint: null });
    setFreeChat((c) => [
      ...c,
      { role: "alfred", text: t.emailCompose.askWho, ts: "now" },
    ]);
    scrollRef.current?.scrollToEnd({ animated: true });
  }, [scrollRef, t.emailCompose.askWho]);

  return {
    freeChat,
    input,
    setInput,
    thinking,
    sendFree,
    sendFreeRef,
    sendEmailDraft,
    voice,
    awaitingSmsPhone,
    awaitingEmailAddress,
    beginSmsFlow,
    beginEmailFlow,
    placeholder: awaitingSmsPhone
      ? t.smsCompose.phonePlaceholder
      : awaitingEmailAddress
        ? t.emailCompose.emailPlaceholder
        : t.alfredHub.composerPlaceholder,
    keyboardType: awaitingSmsPhone
      ? ("phone-pad" as const)
      : awaitingEmailAddress
        ? ("email-address" as const)
        : ("default" as const),
  };
}
