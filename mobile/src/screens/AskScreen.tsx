// Ask / Chat — task threads use real LLM drafts + Gmail send; free chat uses /assistant/chat.

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { api } from "@/api/client";
import { WorkflowDraftCard } from "@/components/WorkflowDraftCard";
import { CompanionAvatar } from "@/components/CompanionAvatar";
import { useCompanionAvatar } from "@/context/CompanionAvatarContext";
import { useLocale } from "@/context/LocaleContext";
import { useMailbox } from "@/context/MailboxContext";
import { useWorkflow } from "@/context/WorkflowContext";
import { type ChatMessage } from "@/data/demo";
import { Ic } from "@/components/icons";
import { useShell } from "@/components/Shell";
import { ApprovalSheet } from "@/screens/sheets/ApprovalSheet";
import { SmsComposeSheet } from "@/screens/sheets/SmsComposeSheet";
import { Btn, Eyebrow, Serif, SerifEm, inputPlaceholder } from "@/components/ui";
import {
  requestContactsPermission,
  searchContactsByName,
  type ContactMatch,
} from "@/lib/contacts";
import {
  normalizePhoneInput,
  parseSmsComposeIntent,
  parseSmsComposeStarter,
} from "@/lib/smsComposeIntent";
import { openSmsCompose } from "@/lib/sms";
import { scheduleFromAssistantResponse } from "@/lib/taskReminders";
import { useVoiceCapture } from "@/api/useVoiceCapture";
import { colors, fonts, layout, radius } from "@/theme/theme";

type TaskMessage = {
  role: "alfred" | "user";
  text: string;
  showDraft?: boolean;
};

type FreeMsg = ChatMessage & {
  smsDraft?: { name: string; phone: string; body: string };
};

type AwaitingSmsBody = {
  displayName: string;
  phone: string;
};

type AwaitingSmsPhone = {
  displayName: string;
  bodyHint: string | null;
};

type AwaitingSmsRecipient = {
  bodyHint: string | null;
};

export function AskScreen() {
  const { openSheet, showToast } = useShell();
  const { syncAndRefresh, markRead } = useMailbox();
  const { meta, state, setThinking } = useCompanionAvatar();
  const { locale, t } = useLocale();
  const { thread, completeChat, cancelChat, reviseDraft, consumePendingFreeChatMessage } =
    useWorkflow();

  const [freeChat, setFreeChat] = useState<FreeMsg[]>([]);
  const [taskChat, setTaskChat] = useState<TaskMessage[]>([]);
  const [input, setInput] = useState("");
  const [thinking, setThinkingLocal] = useState(false);
  const [sending, setSending] = useState(false);
  const [reviseMode, setReviseMode] = useState(false);
  const [awaitingSmsBody, setAwaitingSmsBody] = useState<AwaitingSmsBody | null>(
    null,
  );
  const [awaitingSmsPhone, setAwaitingSmsPhone] = useState<AwaitingSmsPhone | null>(
    null,
  );
  const [awaitingSmsRecipient, setAwaitingSmsRecipient] =
    useState<AwaitingSmsRecipient | null>(null);
  const scrollRef = useRef<ScrollView>(null);

  const voice = useVoiceCapture((r) => {
    const q = r.tasks.map((t) => t.title).join("; ");
    if (q.trim()) sendFreeRef.current(q);
  });

  useEffect(() => {
    setFreeChat([{ role: "alfred", text: t.freeChat.seed, ts: "now" }]);
  }, [locale, t.freeChat.seed]);

  const sendFreeRef = useRef<(text: string) => void>(() => undefined);

  useEffect(() => {
    const pending = consumePendingFreeChatMessage();
    if (pending) sendFreeRef.current(pending);
  }, [consumePendingFreeChatMessage]);

  useEffect(() => {
    if (!thread) return;
    const open =
      thread.mode === "delegate"
        ? t.ask.taskOpenDelegate(thread.sender)
        : t.ask.taskOpenReply(thread.sender);
    setTaskChat([{ role: "alfred", text: open, showDraft: true }]);
    setReviseMode(false);
    setInput("");
  }, [thread?.messageId, thread?.mode, thread?.sender, locale, t.ask]);

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
    [t.smsCompose],
  );

  const resolveSmsRecipient = useCallback(
  (displayName: string, phone: string, bodyHint: string | null) => {
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
    [appendSmsDraft, t.smsCompose],
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
          if (matches.length === 1) {
            const only = matches[0]!;
            resolveSmsRecipient(only.name, only.phone, bodyHint);
            return;
          }
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
              text:
                e instanceof Error ? e.message : t.freeChat.fallback,
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

      if (awaitingSmsRecipient) {
        const { bodyHint } = awaitingSmsRecipient;
        setAwaitingSmsRecipient(null);
        startSmsCompose(q, bodyHint);
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
      awaitingSmsBody,
      awaitingSmsPhone,
      awaitingSmsRecipient,
      resolveSmsRecipient,
      startSmsCompose,
      thinking,
      setThinkingBoth,
      t.freeChat.fallback,
      t.smsCompose,
    ],
  );

  sendFreeRef.current = sendFree;

  const sendRevise = () => {
    const q = input.trim();
    if (!q || !thread || thread.draftLoading) return;
    setThinkingBoth(true);
    void (async () => {
      try {
        await reviseDraft(q);
        setTaskChat((c) => [
          ...c,
          { role: "user", text: q },
          { role: "alfred", text: t.ask.taskRevised, showDraft: true },
        ]);
        setInput("");
        setReviseMode(false);
        scrollRef.current?.scrollToEnd({ animated: true });
      } catch (e) {
        showToast(
          e instanceof Error ? e.message : t.ask.toastSendFailed,
        );
      } finally {
        setThinkingBoth(false);
      }
    })();
  };

  const handleSendDirectly = () => {
    if (!thread || sending || thread.draftLoading) return;

    if (thread.source === "sms") {
      const phone = thread.replyPhone;
      const body = thread.draft.body?.trim();
      if (!phone || !body) {
        showToast(t.ask.smsMissingPhone);
        return;
      }
      openSmsCompose(phone, body);
      void markRead(thread.messageId).catch(() => undefined);
      void syncAndRefresh();
      showToast(t.ask.smsOpened);
      completeChat();
      return;
    }

    if (!thread.draftId) {
      openSheet(
        <ApprovalSheet
          messageId={thread.messageId}
          recipient={thread.sender}
          subject={thread.subject}
          onDone={() => {
            void syncAndRefresh();
            completeChat();
          }}
        />,
      );
      return;
    }
    setSending(true);
    void (async () => {
      try {
        const proposal = await api.proposeSendDraft(thread.draftId!);
        await api.approveAction(proposal.id);
        showToast(t.ask.toastSent);
        await markRead(thread.messageId).catch(() => undefined);
        await syncAndRefresh().catch(() => undefined);
        completeChat();
      } catch (e) {
        showToast(
          e instanceof Error ? e.message : t.ask.toastSendFailed,
        );
      } finally {
        setSending(false);
      }
    })();
  };

  const handleCancel = () => {
    showToast(t.ask.toastCancelled);
    cancelChat();
  };

  if (thread) {
    return (
      <KeyboardAvoidingView
        style={styles.screen}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <View style={styles.taskHeader}>
          <Pressable
            onPress={handleCancel}
            style={styles.backBtn}
            accessibilityLabel={t.a11y.back}
          >
            <View style={styles.backIcon}>
              <Ic.Arrow size={18} color={colors.ink2} />
            </View>
          </Pressable>
          <CompanionAvatar
            size={36}
            level={meta.level}
            color={meta.color}
            state={state}
            compact
          />
          <View style={styles.taskHeaderText}>
            <Text style={styles.taskTitle}>{t.ask.alfred}</Text>
            <Text style={styles.taskStatus}>
              {thread.draftLoading ? t.ask.drafting : t.ask.workingOnIt}
            </Text>
          </View>
        </View>

        <ScrollView
          ref={scrollRef}
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          {thread.mode !== "proactive" ? (
            <EmailSourceCard
              sender={thread.sender}
              subject={thread.subject}
              summary={thread.summary}
              body={thread.body}
              loading={thread.bodyLoading}
              error={thread.bodyError}
              labels={{
                title: t.ask.originalEmail,
                loading: t.ask.loadingEmail,
                summary: t.ask.albertSummary,
              }}
            />
          ) : null}
          {taskChat.map((m, i) => (
            <View key={i} style={styles.taskBubble}>
              <Serif size={16} style={styles.taskText}>
                {m.text}
              </Serif>
              {m.showDraft && thread ? (
                thread.draftLoading ? (
                  <View style={styles.draftLoading}>
                    <ActivityIndicator color={colors.accent} />
                    <Text style={styles.draftLoadingText}>
                      {t.ask.drafting}
                    </Text>
                  </View>
                ) : thread.draftError ? (
                  <Text style={styles.draftError}>{thread.draftError}</Text>
                ) : thread.draft.body ? (
                  <WorkflowDraftCard draft={thread.draft} />
                ) : null
              ) : null}
            </View>
          ))}
        </ScrollView>

        {reviseMode ? (
          <View style={styles.reviseBar}>
            <TextInput
              value={input}
              onChangeText={setInput}
              placeholder={t.ask.revisePlaceholder}
              placeholderTextColor={inputPlaceholder}
              style={styles.reviseInput}
              multiline
              autoFocus
            />
            <Pressable
              style={styles.sendBtn}
              onPress={sendRevise}
              accessibilityLabel={t.a11y.send}
            >
              <Ic.ArrowUp size={16} color="#fff" stroke={2} />
            </Pressable>
          </View>
        ) : (
          <View style={styles.taskActions}>
            <Btn
              label={
                thread.source === "sms"
                  ? t.ask.openInMessages
                  : sending
                    ? "…"
                    : t.ask.sendDirectly
              }
              onPress={handleSendDirectly}
              disabled={
                sending ||
                thread.draftLoading ||
                Boolean(thread.draftError) ||
                (thread.source === "sms" &&
                  (!thread.replyPhone || !thread.draft.body?.trim()))
              }
            />
            <Pressable
              style={styles.actionGhost}
              onPress={() => setReviseMode(true)}
              disabled={thread.draftLoading}
            >
              <Text style={styles.actionGhostText}>{t.ask.reviseWording}</Text>
            </Pressable>
            <Pressable style={styles.actionGhost} onPress={handleCancel}>
              <Text style={styles.actionGhostText}>{t.ask.cancel}</Text>
            </Pressable>
          </View>
        )}
      </KeyboardAvoidingView>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <View style={styles.header}>
        <Serif size={30} style={styles.title}>
          {t.ask.freeTitlePlain} <SerifEm>{t.ask.freeTitleEm}</SerifEm>
        </Serif>
      </View>

      <ScrollView
        ref={scrollRef}
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        onContentSizeChange={() =>
          scrollRef.current?.scrollToEnd({ animated: true })
        }
      >
        {freeChat.map((m, i) => (
          <FreeBubble
            key={i}
            msg={m}
            onOpenSms={(phone, body) => {
              openSmsCompose(phone, body);
              showToast(t.ask.smsOpened);
            }}
            openLabel={t.smsCompose.openInMessages}
          />
        ))}
        {thinking ? (
          <Text style={styles.thinking}>{t.ask.thinking}</Text>
        ) : null}
        {freeChat.length <= 1 && !thinking ? (
          <View style={styles.suggest}>
            {t.askHintGroups.map((group) => (
              <View key={group.label} style={styles.hintGroup}>
                <Eyebrow style={styles.hintEyebrow}>{group.label}</Eyebrow>
                {group.examples.map((q) => (
                  <Pressable
                    key={q}
                    style={styles.suggestItem}
                    onPress={() => sendFree(q)}
                  >
                    <Serif size={14} italic color={colors.ink2}>
                      "{q}"
                    </Serif>
                    <Ic.Arrow size={14} color={colors.ink4} />
                  </Pressable>
                ))}
              </View>
            ))}
            <Text style={styles.inboxHint}>{t.ask.inboxHint}</Text>
          </View>
        ) : null}
      </ScrollView>

      <View style={styles.companionDock} pointerEvents="box-none">
        <CompanionAvatar
          size={48}
          level={meta.level}
          color={meta.color}
          state={state}
          compact
        />
      </View>

      <View style={styles.composer}>
        <View style={styles.composerInner}>
          <TextInput
            value={input}
            onChangeText={setInput}
            placeholder={
              awaitingSmsPhone
                ? t.smsCompose.phonePlaceholder
                : t.ask.freePlaceholder
            }
            placeholderTextColor={inputPlaceholder}
            style={styles.composerInput}
            multiline
            keyboardType={awaitingSmsPhone ? "phone-pad" : "default"}
            onSubmitEditing={() => sendFree(input)}
          />
          <Pressable
            style={styles.sendBtn}
            onPress={() => sendFree(input)}
            accessibilityLabel={t.a11y.send}
          >
            <Ic.ArrowUp size={16} color="#fff" stroke={2} />
          </Pressable>
          {Platform.OS === "android" ? (
            <Pressable
              style={styles.micBtn}
              onPress={() =>
                void (voice.state === "recording" ? voice.stop() : voice.start())
              }
              accessibilityLabel="Voice input"
            >
              {voice.state !== "idle" ? (
                <ActivityIndicator size="small" color={colors.accent} />
              ) : (
                <Ic.Mic size={16} color={colors.accent} stroke={2} />
              )}
            </Pressable>
          ) : null}
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

function EmailSourceCard({
  sender,
  subject,
  summary,
  body,
  loading,
  error,
  labels,
}: {
  sender: string;
  subject: string;
  summary: string | null;
  body: string;
  loading: boolean;
  error: string | null;
  labels: { title: string; loading: string; summary: string };
}) {
  return (
    <View style={styles.emailCard}>
      <Text style={styles.emailCardLabel}>{labels.title}</Text>
      <Text style={styles.emailSubject}>{subject}</Text>
      <Text style={styles.emailFrom}>{sender}</Text>
      {loading ? (
        <View style={styles.emailLoading}>
          <ActivityIndicator color={colors.accent} size="small" />
          <Text style={styles.emailLoadingText}>{labels.loading}</Text>
        </View>
      ) : error ? (
        <Text style={styles.draftError}>{error}</Text>
      ) : (
        <>
          {summary ? (
            <View style={styles.emailSummaryBox}>
              <Text style={styles.emailSummaryLabel}>{labels.summary}</Text>
              <Text style={styles.emailSummaryText}>{summary}</Text>
            </View>
          ) : null}
          <Text style={styles.emailBody}>{body}</Text>
        </>
      )}
    </View>
  );
}

function FreeBubble({
  msg,
  onOpenSms,
  openLabel,
}: {
  msg: FreeMsg;
  onOpenSms?: (phone: string, body: string) => void;
  openLabel: string;
}) {
  const isAlf = msg.role === "alfred";
  return (
    <View style={[styles.bubbleWrap, isAlf ? styles.left : styles.right]}>
      {isAlf ? (
        <>
          <Serif size={17} style={styles.alfText}>
            {msg.text}
          </Serif>
          {msg.smsDraft ? (
            <View style={styles.smsDraftCard}>
              <Text style={styles.smsDraftTo}>
                {msg.smsDraft.name} · {msg.smsDraft.phone}
              </Text>
              <Text style={styles.smsDraftBody}>{msg.smsDraft.body}</Text>
              <Btn
                label={openLabel}
                onPress={() =>
                  onOpenSms?.(msg.smsDraft!.phone, msg.smsDraft!.body)
                }
              />
            </View>
          ) : null}
        </>
      ) : (
        <View style={styles.userBubble}>
          <Text style={styles.userText}>{msg.text}</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.paper },
  header: { paddingHorizontal: layout.padX, paddingTop: layout.topPad, gap: 6 },
  title: { marginTop: 2 },
  taskHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: layout.padX,
    paddingTop: layout.topPad,
    paddingBottom: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.hair,
  },
  backBtn: { padding: 6, marginLeft: -6 },
  backIcon: { transform: [{ rotate: "180deg" }] },
  taskHeaderText: { flex: 1 },
  taskTitle: { fontSize: 16, fontWeight: "600", color: colors.ink },
  taskStatus: {
    fontFamily: fonts.mono,
    fontSize: 10,
    letterSpacing: 0.8,
    color: colors.ink3,
    textTransform: "uppercase",
    marginTop: 2,
  },
  scroll: { flex: 1 },
  scrollContent: { padding: layout.padX, paddingTop: 12, paddingBottom: 24 },
  taskBubble: { marginBottom: 16, maxWidth: "100%" },
  taskText: { color: colors.ink2, lineHeight: 24 },
  emailCard: {
    marginBottom: 20,
    padding: 14,
    backgroundColor: colors.card,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.hair2,
    gap: 8,
  },
  emailCardLabel: {
    fontFamily: fonts.mono,
    fontSize: 10,
    letterSpacing: 1.4,
    textTransform: "uppercase",
    color: colors.ink4,
  },
  emailSubject: { fontSize: 16, fontWeight: "600", color: colors.ink },
  emailFrom: { fontSize: 13, color: colors.ink3 },
  emailLoading: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 12,
  },
  emailLoadingText: { fontSize: 13, color: colors.ink3 },
  emailSummaryBox: {
    padding: 10,
    backgroundColor: colors.paper2,
    borderRadius: 10,
    gap: 4,
  },
  emailSummaryLabel: {
    fontFamily: fonts.mono,
    fontSize: 10,
    letterSpacing: 1,
    textTransform: "uppercase",
    color: colors.ink4,
  },
  emailSummaryText: { fontSize: 13, lineHeight: 19, color: colors.ink2 },
  emailBody: { fontSize: 14, lineHeight: 22, color: colors.ink2 },
  draftLoading: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginTop: 12,
    padding: 16,
    backgroundColor: colors.card,
    borderRadius: 14,
  },
  draftLoadingText: { fontSize: 13, color: colors.ink3 },
  draftError: { color: colors.warn, fontSize: 13, marginTop: 12 },
  taskActions: {
    paddingHorizontal: layout.padX,
    paddingVertical: 12,
    gap: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.hair,
    backgroundColor: colors.paper,
  },
  actionGhost: {
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: radius.sm,
    backgroundColor: colors.paper2,
    alignItems: "center",
  },
  actionGhostText: { fontSize: 14, fontWeight: "500", color: colors.ink2 },
  reviseBar: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 8,
    paddingHorizontal: layout.padX,
    paddingVertical: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.hair,
    backgroundColor: colors.paper,
  },
  reviseInput: {
    flex: 1,
    fontSize: 15,
    color: colors.ink,
    backgroundColor: colors.card,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.hair2,
    maxHeight: 100,
  },
  suggest: { marginTop: 8, gap: 16 },
  hintGroup: { gap: 6 },
  hintEyebrow: { marginBottom: 2 },
  inboxHint: {
    fontSize: 12,
    lineHeight: 17,
    color: colors.ink4,
    marginTop: 4,
  },
  suggestItem: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    paddingVertical: 12,
    paddingHorizontal: 14,
    backgroundColor: colors.card,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.hair2,
    marginBottom: 6,
  },
  thinking: {
    fontFamily: fonts.mono,
    fontSize: 11,
    color: colors.ink3,
    fontStyle: "italic",
    marginBottom: 8,
  },
  bubbleWrap: { marginBottom: 14, maxWidth: "88%" },
  left: { alignSelf: "flex-start" },
  right: { alignSelf: "flex-end" },
  alfText: { lineHeight: 25 },
  smsDraftCard: {
    marginTop: 12,
    padding: 14,
    backgroundColor: colors.card,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.hair2,
    gap: 10,
  },
  smsDraftTo: { fontSize: 13, color: colors.ink3 },
  smsDraftBody: { fontSize: 15, lineHeight: 22, color: colors.ink2 },
  userBubble: {
    backgroundColor: colors.ink,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 18,
  },
  userText: { color: colors.paper, fontSize: 14.5, lineHeight: 21 },
  companionDock: {
    position: "absolute",
    right: layout.padX,
    bottom: 72,
    zIndex: 2,
  },
  composer: {
    paddingHorizontal: layout.padX,
    paddingTop: 8,
    paddingBottom: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.hair,
    backgroundColor: colors.paper,
  },
  composerInner: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 8,
    backgroundColor: colors.card,
    borderRadius: 22,
    paddingVertical: 6,
    paddingLeft: 14,
    paddingRight: 6,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.hair2,
  },
  composerInput: {
    flex: 1,
    fontSize: 15,
    color: colors.ink,
    maxHeight: 100,
    paddingVertical: 6,
  },
  sendBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.accent,
    alignItems: "center",
    justifyContent: "center",
  },
  micBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
});
