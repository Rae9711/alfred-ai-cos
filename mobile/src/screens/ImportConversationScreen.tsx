// Import a WeChat multi-select paste → context checklist → replies + actions.

import { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import type {
  ConversationAction,
  ConversationAnalyzeResponse,
  ParsedConversation,
  ReplySuggestion,
} from "@albert/shared-types";
import * as Clipboard from "expo-clipboard";

import { api } from "@/api/client";
import { Ic } from "@/components/icons";
import { Btn, Eyebrow, IconBtn, Meta, Pill, Serif, SerifEm } from "@/components/ui";
import { scheduleLocalTaskReminder } from "@/lib/taskReminders";
import { colors, fonts, layout } from "@/theme/theme";

type Phase = "paste" | "context" | "results";

type GoalId = "comfort" | "follow_up" | "confirm" | "custom";

const GOALS: { id: GoalId; label: string }[] = [
  { id: "comfort", label: "安慰" },
  { id: "follow_up", label: "继续追问" },
  { id: "confirm", label: "确认安排" },
  { id: "custom", label: "自定义" },
];

const TONE_LABELS: Record<string, string> = {
  natural: "自然",
  caring: "关心",
  brief: "简短",
};

function tierLabel(tier: ConversationAction["tier"]): string {
  if (tier === "explicit_time") return "明确时间";
  if (tier === "follow_up_suggestion") return "建议跟进";
  return "待办";
}

function actionKindLabel(kind: ConversationAction["type"]): string {
  if (kind === "calendar_event") return "日程";
  if (kind === "follow_up") return "跟进";
  if (kind === "commitment") return "承诺";
  return "待办";
}

export function ImportConversationScreen({ onClose }: { onClose: () => void }) {
  const [phase, setPhase] = useState<Phase>("paste");
  const [rawText, setRawText] = useState("");
  const [conversation, setConversation] = useState<ParsedConversation | null>(null);
  const [goal, setGoal] = useState<GoalId>("custom");
  const [customGoal, setCustomGoal] = useState("");
  const [analysis, setAnalysis] = useState<ConversationAnalyzeResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ignoredActionIds, setIgnoredActionIds] = useState<Set<string>>(new Set());
  const [confirmedActionIds, setConfirmedActionIds] = useState<Set<string>>(new Set());
  const [selectedReply, setSelectedReply] = useState<ReplySuggestion | null>(null);

  const selectedCount = useMemo(
    () => conversation?.messages.filter((m) => m.is_selected).length ?? 0,
    [conversation],
  );

  const readClipboard = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const text = await Clipboard.getStringAsync();
      if (!text.trim()) {
        setError("剪贴板是空的 — 先在微信里多选复制几条消息");
        return;
      }
      setRawText(text);
      const parsed = await api.parseConversation(text);
      setConversation(parsed);
      setPhase("context");
    } catch (e) {
      setError(e instanceof Error ? e.message : "无法读取剪贴板");
    } finally {
      setBusy(false);
    }
  }, []);

  const parsePasted = useCallback(async () => {
    const text = rawText.trim();
    if (!text) return;
    setBusy(true);
    setError(null);
    try {
      const parsed = await api.parseConversation(text);
      setConversation(parsed);
      setPhase("context");
    } catch (e) {
      setError(e instanceof Error ? e.message : "解析失败");
    } finally {
      setBusy(false);
    }
  }, [rawText]);

  const toggleMessage = (id: string) => {
    setConversation((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        messages: prev.messages.map((m) =>
          m.id === id ? { ...m, is_selected: !m.is_selected } : m,
        ),
      };
    });
  };

  const runAnalyze = useCallback(async () => {
    if (!conversation) return;
    setBusy(true);
    setError(null);
    try {
      const goalText =
        goal === "custom" && customGoal.trim() ? customGoal.trim() : goal;
      const result = await api.analyzeConversation({
        conversation,
        goal: goalText,
      });
      setAnalysis(result);
      setSelectedReply(result.reply_suggestions[0] ?? null);
      setPhase("results");
    } catch (e) {
      setError(e instanceof Error ? e.message : "分析失败");
    } finally {
      setBusy(false);
    }
  }, [conversation, goal, customGoal]);

  const insertReply = useCallback(async (reply: ReplySuggestion) => {
    await Clipboard.setStringAsync(reply.body);
    Alert.alert("已复制", "回复已复制到剪贴板，回到微信粘贴即可。");
  }, []);

  const confirmAction = useCallback(
    async (action: ConversationAction, opts?: { setReminder?: boolean }) => {
      try {
        const setReminder =
          opts?.setReminder ?? action.tier === "explicit_time";
        const res = await api.confirmConversationAction({
          type: action.type,
          title: action.title,
          conversation_id: conversation?.id,
          evidence: action.evidence,
          evidence_message_ids: action.evidence_message_ids,
          confidence: action.confidence,
          due_date: action.due_date,
          start: action.start,
          end: action.end,
          suggested_time: action.suggested_time,
          set_reminder: setReminder,
        });
        setConfirmedActionIds((prev) => new Set(prev).add(action.id));
        // Local notifications only for confirmed, time-bearing actions.
        if (res.kind === "task" && res.remind_at) {
          await scheduleLocalTaskReminder({
            taskId: res.id,
            title: res.title,
            remindAt: res.remind_at,
          });
          const when = new Date(res.remind_at).toLocaleString(undefined, {
            month: "short",
            day: "numeric",
            hour: "numeric",
            minute: "2-digit",
          });
          Alert.alert("已加入 Alfred", `已设本地提醒 · ${when}\n可在首页「从对话中发现」查看证据。`);
        } else {
          Alert.alert("已加入 Alfred", "可在首页「从对话中发现」查看证据。");
        }
      } catch (e) {
        Alert.alert("保存失败", e instanceof Error ? e.message : "请稍后再试");
      }
    },
    [conversation?.id],
  );

  const visibleActions =
    analysis?.actions.filter((a) => !ignoredActionIds.has(a.id)) ?? [];

  return (
    <View style={styles.screen}>
      <View style={styles.top}>
        <IconBtn onPress={onClose}>
          <Ic.Close size={18} color={colors.ink2} />
        </IconBtn>
        <Eyebrow>
          {phase === "paste"
            ? "导入对话"
            : phase === "context"
              ? "回复上下文"
              : "建议与行动"}
        </Eyebrow>
        <View style={styles.topSpacer} />
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        {phase === "paste" ? (
          <PastePhase
            rawText={rawText}
            setRawText={setRawText}
            busy={busy}
            error={error}
            onReadClipboard={() => void readClipboard()}
            onParse={() => void parsePasted()}
          />
        ) : null}

        {phase === "context" && conversation ? (
          <ContextPhase
            conversation={conversation}
            selectedCount={selectedCount}
            goal={goal}
            setGoal={setGoal}
            customGoal={customGoal}
            setCustomGoal={setCustomGoal}
            busy={busy}
            error={error}
            onToggle={toggleMessage}
            onAnalyze={() => void runAnalyze()}
          />
        ) : null}

        {phase === "results" && analysis ? (
          <ResultsPhase
            actions={visibleActions}
            replies={analysis.reply_suggestions}
            selectedReply={selectedReply}
            setSelectedReply={setSelectedReply}
            confirmedActionIds={confirmedActionIds}
            onIgnore={(id) =>
              setIgnoredActionIds((prev) => new Set(prev).add(id))
            }
            onConfirm={(a, opts) => void confirmAction(a, opts)}
            onInsert={(r) => void insertReply(r)}
            onBack={() => setPhase("context")}
          />
        ) : null}
      </ScrollView>
    </View>
  );
}

function PastePhase({
  rawText,
  setRawText,
  busy,
  error,
  onReadClipboard,
  onParse,
}: {
  rawText: string;
  setRawText: (t: string) => void;
  busy: boolean;
  error: string | null;
  onReadClipboard: () => void;
  onParse: () => void;
}) {
  return (
    <View style={styles.block}>
      <Serif size={28} style={styles.heading}>
        把微信对话变成 <SerifEm>可执行行动</SerifEm>
      </Serif>
      <Text style={styles.sub}>
        在微信里多选最近几条关键消息并复制，然后点导入。Alfred
        会整理上下文、生成回复，并找出待办、日程和跟进。
      </Text>

      <View style={styles.tipBox}>
        <Text style={styles.tipTitle}>复制小提示</Text>
        <Text style={styles.tipBody}>
          · 长按气泡 → 多选 → 复制（带发送者姓名效果最好）{"\n"}
          · 表情 / 「已读」「好」等短回复会自动降权{"\n"}
          · 系统提示、「以上是历史消息」会被忽略{"\n"}
          · 键盘导入需开启「完全访问」才能读剪贴板
        </Text>
      </View>

      <Btn
        label={busy ? "读取中…" : "从剪贴板导入"}
        kind="accent"
        full
        disabled={busy}
        onPress={onReadClipboard}
        leading={<Ic.Forward size={14} color="#fff" />}
      />

      <Text style={styles.or}>或粘贴到下方</Text>
      <TextInput
        value={rawText}
        onChangeText={setRawText}
        multiline
        placeholder={"6330\n我需要审一下\n\nRui🌞\n一吃一堆"}
        placeholderTextColor={colors.ink4}
        style={styles.textArea}
      />
      <Btn
        label={busy ? "解析中…" : "解析对话"}
        kind="ghost"
        full
        disabled={busy || !rawText.trim()}
        onPress={onParse}
      />
      {busy ? <ActivityIndicator color={colors.accent} style={{ marginTop: 12 }} /> : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
}

function ContextPhase({
  conversation,
  selectedCount,
  goal,
  setGoal,
  customGoal,
  setCustomGoal,
  busy,
  error,
  onToggle,
  onAnalyze,
}: {
  conversation: ParsedConversation;
  selectedCount: number;
  goal: GoalId;
  setGoal: (g: GoalId) => void;
  customGoal: string;
  setCustomGoal: (t: string) => void;
  busy: boolean;
  error: string | null;
  onToggle: (id: string) => void;
  onAnalyze: () => void;
}) {
  return (
    <View style={styles.block}>
      <Serif size={24}>
        回复上下文 · {selectedCount} 条
      </Serif>
      <Meta style={{ marginTop: 6 }}>
        默认已选中；取消勾选无关内容即可。明显噪音已自动降权。
      </Meta>

      <View style={styles.msgList}>
        {conversation.messages.map((m) => (
          <Pressable
            key={m.id}
            onPress={() => onToggle(m.id)}
            style={[styles.msgRow, !m.is_selected && styles.msgRowOff]}
          >
            <Text style={styles.check}>{m.is_selected ? "☑" : "☐"}</Text>
            <View style={styles.msgBody}>
              <Text style={styles.msgSender}>{m.sender}</Text>
              <Text style={styles.msgContent} numberOfLines={3}>
                {m.content}
              </Text>
              {m.weight < 1 ? <Pill label="降权" kind="muted" /> : null}
            </View>
          </Pressable>
        ))}
      </View>

      <Text style={styles.sectionLabel}>回复目标</Text>
      <View style={styles.goalRow}>
        {GOALS.map((g) => (
          <Pressable
            key={g.id}
            onPress={() => setGoal(g.id)}
            style={[styles.goalChip, goal === g.id && styles.goalChipOn]}
          >
            <Text style={[styles.goalText, goal === g.id && styles.goalTextOn]}>
              {g.label}
            </Text>
          </Pressable>
        ))}
      </View>
      {goal === "custom" ? (
        <TextInput
          value={customGoal}
          onChangeText={setCustomGoal}
          placeholder="自定义目标，例如：温和地推迟见面"
          placeholderTextColor={colors.ink4}
          style={styles.customGoal}
        />
      ) : null}

      <Btn
        label={busy ? "分析中…" : "生成回复与行动"}
        kind="accent"
        full
        disabled={busy || selectedCount === 0}
        onPress={onAnalyze}
        style={{ marginTop: 16 }}
      />
      {busy ? <ActivityIndicator color={colors.accent} style={{ marginTop: 12 }} /> : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
}

function ResultsPhase({
  actions,
  replies,
  selectedReply,
  setSelectedReply,
  confirmedActionIds,
  onIgnore,
  onConfirm,
  onInsert,
  onBack,
}: {
  actions: ConversationAction[];
  replies: ReplySuggestion[];
  selectedReply: ReplySuggestion | null;
  setSelectedReply: (r: ReplySuggestion | null) => void;
  confirmedActionIds: Set<string>;
  onIgnore: (id: string) => void;
  onConfirm: (a: ConversationAction, opts?: { setReminder?: boolean }) => void;
  onInsert: (r: ReplySuggestion) => void;
  onBack: () => void;
}) {
  return (
    <View style={styles.block}>
      {actions.length > 0 ? (
        <>
          <Text style={styles.sectionLabel}>Alfred 检测到的行动</Text>
          <View style={styles.actionList}>
            {actions.map((a) => {
              const confirmed = confirmedActionIds.has(a.id);
              return (
                <View key={a.id} style={styles.actionCard}>
                  <View style={styles.actionHead}>
                    <Pill label={actionKindLabel(a.type)} kind="accent" />
                    <Pill label={tierLabel(a.tier)} kind="muted" />
                  </View>
                  <Text style={styles.actionTitle}>{a.title}</Text>
                  {a.start ? (
                    <Meta>
                      {new Date(a.start).toLocaleString(undefined, {
                        month: "short",
                        day: "numeric",
                        hour: "numeric",
                        minute: "2-digit",
                      })}
                    </Meta>
                  ) : a.suggested_time ? (
                    <Meta>{a.suggested_time}</Meta>
                  ) : null}
                  <Text style={styles.evidence}>来自：「{a.evidence}」</Text>
                  {confirmed ? (
                    <Text style={styles.saved}>已加入 Alfred</Text>
                  ) : (
                    <View style={styles.actionBtns}>
                      {a.type === "calendar_event" ? (
                        <Btn
                          label="添加日历"
                          kind="accent"
                          tiny
                          onPress={() => onConfirm(a)}
                        />
                      ) : a.type === "follow_up" ? (
                        <>
                          <Btn
                            label="添加跟进"
                            kind="accent"
                            tiny
                            onPress={() => onConfirm(a)}
                          />
                          <Btn
                            label="今晚提醒"
                            kind="ghost"
                            tiny
                            onPress={() =>
                              onConfirm(
                                {
                                  ...a,
                                  suggested_time: a.suggested_time ?? "tonight",
                                },
                                { setReminder: true },
                              )
                            }
                          />
                        </>
                      ) : (
                        <>
                          <Btn
                            label="加入 Alfred"
                            kind="accent"
                            tiny
                            onPress={() => onConfirm(a)}
                          />
                          {a.tier !== "follow_up_suggestion" ? (
                            <Btn
                              label="今晚提醒"
                              kind="ghost"
                              tiny
                              onPress={() =>
                                onConfirm({
                                  ...a,
                                  suggested_time: a.suggested_time ?? "tonight",
                                }, { setReminder: true })
                              }
                            />
                          ) : null}
                        </>
                      )}
                      <Btn label="忽略" kind="ghost" tiny onPress={() => onIgnore(a.id)} />
                    </View>
                  )}
                </View>
              );
            })}
          </View>
        </>
      ) : (
        <Meta>这段对话里没有明显需要跟进的行动。</Meta>
      )}

      <Text style={[styles.sectionLabel, { marginTop: 22 }]}>建议回复</Text>
      <View style={styles.replyList}>
        {replies.map((r) => {
          const on = selectedReply?.body === r.body;
          return (
            <Pressable
              key={`${r.tone}-${r.body.slice(0, 12)}`}
              onPress={() => setSelectedReply(r)}
              style={[styles.replyCard, on && styles.replyCardOn]}
            >
              <Text style={styles.replyTone}>
                {TONE_LABELS[r.tone] ?? r.tone}
              </Text>
              <Text style={styles.replyBody}>{r.body}</Text>
            </Pressable>
          );
        })}
      </View>

      <View style={styles.footerRow}>
        <Btn label="返回调整" kind="ghost" onPress={onBack} style={{ flex: 1 }} />
        <Btn
          label="插入回复"
          kind="accent"
          disabled={!selectedReply}
          onPress={() => selectedReply && onInsert(selectedReply)}
          style={{ flex: 2 }}
          leading={<Ic.Check size={12} color="#fff" stroke={2.4} />}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.paper },
  top: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: layout.padX,
    paddingTop: layout.topPad,
    paddingBottom: 8,
  },
  topSpacer: { width: 36 },
  scroll: { flex: 1 },
  content: { paddingHorizontal: layout.padX, paddingBottom: 40 },
  block: { gap: 4 },
  heading: { marginTop: 8, maxWidth: 320, lineHeight: 34 },
  sub: { color: colors.ink3, fontSize: 14, lineHeight: 21, marginVertical: 12 },
  tipBox: {
    backgroundColor: colors.card,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.hair,
    padding: 12,
    marginBottom: 14,
    gap: 6,
  },
  tipTitle: {
    fontFamily: fonts.mono,
    fontSize: 11,
    letterSpacing: 1,
    textTransform: "uppercase",
    color: colors.ink3,
  },
  tipBody: { color: colors.ink2, fontSize: 13, lineHeight: 20 },
  or: {
    textAlign: "center",
    color: colors.ink4,
    fontFamily: fonts.mono,
    fontSize: 11,
    letterSpacing: 1.2,
    textTransform: "uppercase",
    marginVertical: 14,
  },
  textArea: {
    minHeight: 140,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.hair2,
    borderRadius: 16,
    padding: 14,
    backgroundColor: colors.card,
    color: colors.ink,
    fontSize: 15,
    lineHeight: 22,
    textAlignVertical: "top",
    marginBottom: 10,
  },
  error: { color: colors.warn, fontSize: 13, marginTop: 10 },
  msgList: { marginTop: 16, gap: 8 },
  msgRow: {
    flexDirection: "row",
    gap: 10,
    backgroundColor: colors.card,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.hair,
    padding: 12,
  },
  msgRowOff: { opacity: 0.45 },
  check: { fontSize: 16, color: colors.ink2, marginTop: 2 },
  msgBody: { flex: 1, gap: 4 },
  msgSender: {
    fontFamily: fonts.mono,
    fontSize: 11,
    color: colors.ink3,
    letterSpacing: 0.4,
  },
  msgContent: { fontSize: 15, color: colors.ink, lineHeight: 21 },
  sectionLabel: {
    marginTop: 18,
    marginBottom: 8,
    fontFamily: fonts.mono,
    fontSize: 10,
    letterSpacing: 1.4,
    textTransform: "uppercase",
    color: colors.ink4,
  },
  goalRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  goalChip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: colors.paper2,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.hair,
  },
  goalChipOn: { backgroundColor: colors.accentSoft, borderColor: colors.accent },
  goalText: { fontSize: 13, color: colors.ink2 },
  goalTextOn: { color: colors.accentInk, fontWeight: "600" },
  customGoal: {
    marginTop: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.hair2,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: colors.card,
    color: colors.ink,
    fontSize: 14,
  },
  actionList: { gap: 10 },
  actionCard: {
    backgroundColor: colors.card,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.hair,
    padding: 14,
    gap: 6,
  },
  actionHead: { flexDirection: "row", gap: 6 },
  actionTitle: { fontSize: 16, color: colors.ink, lineHeight: 22 },
  evidence: { fontSize: 13, color: colors.ink3, fontStyle: "italic", marginTop: 2 },
  actionBtns: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 8 },
  saved: { color: colors.accent, fontSize: 13, marginTop: 6 },
  replyList: { gap: 8 },
  replyCard: {
    backgroundColor: colors.card,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.hair,
    padding: 14,
  },
  replyCardOn: { borderColor: colors.accent, backgroundColor: colors.accentSoft },
  replyTone: {
    fontFamily: fonts.mono,
    fontSize: 11,
    letterSpacing: 1.2,
    textTransform: "uppercase",
    color: colors.ink3,
    marginBottom: 6,
  },
  replyBody: { fontSize: 15, lineHeight: 22, color: colors.ink },
  footerRow: { flexDirection: "row", gap: 8, marginTop: 20 },
});
