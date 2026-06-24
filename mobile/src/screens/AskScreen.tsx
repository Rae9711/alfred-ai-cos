// Ask / Chat — task threads use real LLM drafts + Gmail send; free chat uses /assistant/ask.

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
import { Btn, Serif, SerifEm, inputPlaceholder } from "@/components/ui";
import { colors, fonts, layout, radius } from "@/theme/theme";

type TaskMessage = {
  role: "alfred" | "user";
  text: string;
  showDraft?: boolean;
};

export function AskScreen() {
  const { openSheet, showToast } = useShell();
  const { syncAndRefresh, markRead } = useMailbox();
  const { meta, state, setThinking } = useCompanionAvatar();
  const { locale, t } = useLocale();
  const { thread, completeChat, cancelChat, reviseDraft } = useWorkflow();

  const [freeChat, setFreeChat] = useState<ChatMessage[]>([]);
  const [taskChat, setTaskChat] = useState<TaskMessage[]>([]);
  const [input, setInput] = useState("");
  const [thinking, setThinkingLocal] = useState(false);
  const [sending, setSending] = useState(false);
  const [reviseMode, setReviseMode] = useState(false);
  const scrollRef = useRef<ScrollView>(null);

  useEffect(() => {
    setFreeChat([{ role: "alfred", text: t.freeChat.seed, ts: "now" }]);
  }, [locale, t.freeChat.seed]);

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

  const sendFree = useCallback(
    (text: string) => {
      const q = text.trim();
      if (!q || thinking) return;
      setFreeChat((c) => [...c, { role: "user", text: q, ts: "now" }]);
      setInput("");
      setThinkingBoth(true);
      scrollRef.current?.scrollToEnd({ animated: true });
      void (async () => {
        try {
          const res = await api.ask(q);
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
    [thinking, setThinkingBoth, t.freeChat.fallback],
  );

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
        await syncAndRefresh();
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
              label={sending ? "…" : t.ask.sendDirectly}
              onPress={handleSendDirectly}
              disabled={
                sending || thread.draftLoading || Boolean(thread.draftError)
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
          <FreeBubble key={i} msg={m} />
        ))}
        {thinking ? (
          <Text style={styles.thinking}>{t.ask.thinking}</Text>
        ) : null}
        {freeChat.length <= 1 && !thinking ? (
          <View style={styles.suggest}>
            <Text style={styles.suggestLabel}>{t.ask.tryAsking}</Text>
            {t.suggest.map((q) => (
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
            placeholder={t.ask.freePlaceholder}
            placeholderTextColor={inputPlaceholder}
            style={styles.composerInput}
            multiline
            onSubmitEditing={() => sendFree(input)}
          />
          <Pressable
            style={styles.sendBtn}
            onPress={() => sendFree(input)}
            accessibilityLabel={t.a11y.send}
          >
            <Ic.ArrowUp size={16} color="#fff" stroke={2} />
          </Pressable>
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

function FreeBubble({ msg }: { msg: ChatMessage }) {
  const isAlf = msg.role === "alfred";
  return (
    <View style={[styles.bubbleWrap, isAlf ? styles.left : styles.right]}>
      {isAlf ? (
        <Serif size={17} style={styles.alfText}>
          {msg.text}
        </Serif>
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
  suggest: { marginTop: 4 },
  suggestLabel: {
    fontFamily: fonts.mono,
    fontSize: 10,
    letterSpacing: 1.4,
    textTransform: "uppercase",
    color: colors.ink4,
    marginBottom: 10,
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
});
