// Import a WeChat multi-select paste → context checklist → replies + actions.
// Full-screen workstation (not the cramped keyboard). Also accepts keyboard handoff
// via App Group / albert://conversation/{id}.

import { useCallback, useEffect, useMemo, useState } from "react";
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
  ConversationMessage,
  ParsedConversation,
  ReplySuggestion,
} from "@albert/shared-types";
import * as Clipboard from "expo-clipboard";

import { api } from "@/api/client";
import { AlfredIcon } from "@/components/AlfredIcon";
import { IconLabel } from "@/components/IconLabel";
import { Ic } from "@/components/icons";
import { ScreenWash } from "@/components/ScreenWash";
import { Btn, Disclose, IconBtn, Meta, Pill, Serif, SerifEm } from "@/components/ui";
import { scheduleLocalTaskReminder } from "@/lib/taskReminders";
import { useLocale } from "@/context/LocaleContext";
import { colors, fonts, layout, radius, spacing } from "@/theme/theme";
import { surfaces } from "@/theme/surfaces";

type Phase = "paste" | "context" | "results";

/** Keyboard App Group payload — kept local so we never static-import the native module. */
type PendingHandoff = {
  conversation_id?: string;
  conversation?: Record<string, unknown>;
  insight?: string;
  replies?: unknown[];
  actions?: unknown[];
  clipboard_text?: string;
  [key: string]: unknown;
};

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

function deriveInsight(
  analysis: ConversationAnalyzeResponse | null,
  conversation: ParsedConversation | null,
): string {
  const fromApi = analysis?.insight?.trim();
  if (fromApi) return fromApi;
  const actionTitle = analysis?.actions?.[0]?.title?.trim();
  if (actionTitle) return actionTitle;
  const selected = conversation?.messages.filter((m) => m.is_selected) ?? [];
  if (selected.length > 0) {
    const last = selected[selected.length - 1];
    const snippet = (last?.content ?? "").trim().replace(/\n/g, " ");
    if (selected.length >= 2 && snippet) {
      return `已读 ${selected.length} 条消息，结合整段对话回复（最新：「${snippet.slice(0, 28)}」）`;
    }
    if (snippet) return `围绕「${snippet.slice(0, 36)}」继续推进`;
  }
  return "已分析对话，可插入回复";
}

function handoffToConversation(h: PendingHandoff): ParsedConversation | null {
  const raw = h.conversation;
  if (!raw || typeof raw !== "object") return null;
  const messages = Array.isArray(raw.messages) ? raw.messages : [];
  if (messages.length === 0) return null;
  return {
    id: String(raw.id ?? h.conversation_id ?? "pending"),
    source: (raw.source as ParsedConversation["source"]) ?? "wechat",
    participants: Array.isArray(raw.participants)
      ? (raw.participants as ParsedConversation["participants"])
      : [],
    messages: (messages as unknown[]).map((m, i) => {
      const msg = m as Record<string, unknown>;
      return {
        id: String(msg.id ?? `m${i}`),
        sender: String(msg.sender ?? ""),
        content: String(msg.content ?? ""),
        role: (msg.role as ConversationMessage["role"]) ?? "unknown",
        is_selected: Boolean(msg.is_selected ?? true),
        weight: typeof msg.weight === "number" ? msg.weight : 1,
        timestamp: typeof msg.timestamp === "string" ? msg.timestamp : null,
      };
    }),
    imported_at:
      typeof raw.imported_at === "string"
        ? raw.imported_at
        : new Date().toISOString(),
  };
}

/** Prefer full-thread selection after parse (noise stays off). */
function withFullThreadSelection(parsed: ParsedConversation): ParsedConversation {
  const selectedCount = parsed.messages.filter((m) => m.is_selected).length;
  const underSelected =
    selectedCount === 0 ||
    (parsed.messages.length >= 3 &&
      selectedCount < Math.max(2, Math.ceil(parsed.messages.length / 2)));
  if (!underSelected) return parsed;
  const nonNoise = parsed.messages.filter((m) => (m.weight ?? 1) >= 1);
  const keep = new Set((nonNoise.length ? nonNoise : parsed.messages).map((m) => m.id));
  return {
    ...parsed,
    messages: parsed.messages.map((m) => ({
      ...m,
      is_selected: keep.has(m.id),
    })),
  };
}

function handoffToAnalysis(h: PendingHandoff): ConversationAnalyzeResponse | null {
  const replies = Array.isArray(h.replies) ? h.replies : [];
  const actions = Array.isArray(h.actions) ? h.actions : [];
  if (replies.length === 0 && actions.length === 0 && !h.insight) return null;
  return {
    reply_suggestions: (replies as unknown[]).map((r) => {
      const row = r as Record<string, unknown>;
      return {
        tone: String(row.tone ?? "natural"),
        body: String(row.body ?? ""),
      };
    }),
    actions: (actions as unknown[]).map((a) => {
      const row = a as Record<string, unknown>;
      return {
        id: String(row.id ?? ""),
        type: (row.type as ConversationAction["type"]) ?? "follow_up",
        title: String(row.title ?? ""),
        due_date: (row.due_date as string | null) ?? null,
        start: (row.start as string | null) ?? null,
        end: (row.end as string | null) ?? null,
        suggested_time: (row.suggested_time as string | null) ?? null,
        confidence: typeof row.confidence === "number" ? row.confidence : 0,
        evidence: String(row.evidence ?? ""),
        evidence_message_ids: Array.isArray(row.evidence_message_ids)
          ? (row.evidence_message_ids as string[])
          : [],
        tier: (row.tier as ConversationAction["tier"]) ?? "action_no_time",
        status: String(row.status ?? "suggested"),
      };
    }),
    insight: typeof h.insight === "string" ? h.insight : null,
  };
}

export function ImportConversationScreen({
  onClose,
  deepLinkConversationId,
}: {
  /** When omitted (e.g. Chats tab), the close control is hidden. */
  onClose?: () => void;
  deepLinkConversationId?: string;
}) {
  const { t } = useLocale();
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
  const [handoffNote, setHandoffNote] = useState<string | null>(null);

  const selectedCount = useMemo(
    () => conversation?.messages.filter((m) => m.is_selected).length ?? 0,
    [conversation],
  );
  const ignoredCount = useMemo(
    () => conversation?.messages.filter((m) => !m.is_selected).length ?? 0,
    [conversation],
  );

  const insight = useMemo(
    () => deriveInsight(analysis, conversation),
    [analysis, conversation],
  );

  // Consume keyboard App Group handoff when opened via 展开 / deep link.
  // Dynamic import only — static alfred-shared-storage at route load can hard-crash
  // cold start on a bad native bridge.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const { takePendingConversationHandoff } = await import("alfred-shared-storage");
        const handoff = await takePendingConversationHandoff();
        if (cancelled || !handoff) {
          if (deepLinkConversationId && deepLinkConversationId !== "pending") {
            setHandoffNote(
              `来自键盘 · conversation ${deepLinkConversationId.slice(0, 8)}… — 请粘贴或从剪贴板导入以继续`,
            );
          }
          return;
        }
        const conv = handoffToConversation(handoff);
        const anal = handoffToAnalysis(handoff);
        if (conv && anal) {
          setConversation(conv);
          setAnalysis(anal);
          setSelectedReply(anal.reply_suggestions[0] ?? null);
          setPhase("results");
          setHandoffNote("已从键盘展开加载");
        } else if (conv) {
          setConversation(conv);
          setPhase("context");
          setHandoffNote("已从键盘导入上下文");
        } else if (typeof handoff.clipboard_text === "string" && handoff.clipboard_text) {
          setRawText(handoff.clipboard_text);
          setHandoffNote("已收到键盘剪贴板内容");
        }
      } catch {
        // Expo Go / missing native module — ignore.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [deepLinkConversationId]);

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
      setConversation(withFullThreadSelection(parsed));
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
      setConversation(withFullThreadSelection(parsed));
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
          Alert.alert("已加入 Alfred", `已设本地提醒 · ${when}\n可在首页「需要跟进」查看。`);
        } else {
          Alert.alert("已加入 Alfred", "可在首页「需要跟进」查看。");
        }
      } catch (e) {
        Alert.alert("保存失败", e instanceof Error ? e.message : "请稍后再试");
      }
    },
    [conversation?.id],
  );

  const visibleActions =
    analysis?.actions.filter((a) => !ignoredActionIds.has(a.id)) ?? [];
  const phaseTitle =
    phase === "paste"
      ? t.chats.title
      : phase === "context"
        ? "回复上下文"
        : "工作台";
  const phaseKicker =
    phase === "paste"
      ? t.chats.eyebrow
      : phase === "context"
        ? t.importFlow.titlePlain
        : t.chats.eyebrow;

  return (
    <View style={styles.screen}>
      <ScreenWash />
      <View style={styles.top}>
        <View style={styles.topCopy}>
          <Text style={styles.kicker}>{phaseKicker}</Text>
          <Serif size={28} display style={styles.topTitle}>
            {phaseTitle}
          </Serif>
        </View>
        {onClose ? (
          <IconBtn onPress={onClose}>
            <Ic.Close size={18} color={colors.ink2} />
          </IconBtn>
        ) : (
          <View style={styles.roundTool}>
            <AlfredIcon icon={Ic.Chat} tone="purple" size="small" />
          </View>
        )}
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        {handoffNote ? <Text style={styles.handoffNote}>{handoffNote}</Text> : null}

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
            ignoredCount={ignoredCount}
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

        {phase === "results" && analysis && conversation ? (
          <ResultsPhase
            conversation={conversation}
            insight={insight}
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
  const { t } = useLocale();
  const flow = t.importFlow;
  const chats = t.chats;

  return (
    <View style={styles.block}>
      <Serif size={26} style={styles.heading}>
        {flow.titlePlain} <SerifEm>{flow.titleEm}</SerifEm>
      </Serif>
      <Text style={styles.sub}>{flow.sub}</Text>

      <View style={styles.pasteCard}>
        <IconLabel
          icon={Ic.Forward}
          tone="purple"
          title={busy ? flow.reading : flow.pasteCta}
          description={chats.explainWechat}
          onPress={busy ? undefined : onReadClipboard}
          active
        />
      </View>

      <Text style={styles.or}>{flow.orPaste}</Text>
      <TextInput
        value={rawText}
        onChangeText={setRawText}
        multiline
        placeholder={"6330\n我需要审一下\n\nRui\n一吃一堆"}
        placeholderTextColor={colors.ink4}
        style={styles.textArea}
      />
      <Pressable
        onPress={onParse}
        disabled={busy || !rawText.trim()}
        style={[
          styles.primaryCta,
          (busy || !rawText.trim()) && styles.primaryCtaDisabled,
        ]}
      >
        <AlfredIcon icon={Ic.Sparkles} tone="blue" size="small" />
        <Text style={styles.primaryCtaText}>
          {busy ? flow.parsing : flow.parseCta}
        </Text>
      </Pressable>

      <Text style={styles.keyboardHint}>{chats.keyboardHint}</Text>

      <Disclose
        label={flow.showTips}
        labelExpanded={flow.hideTips}
        style={{ marginTop: 4 }}
      >
        <View style={styles.tipBox}>
          <Text style={styles.tipTitle}>{flow.tipTitle}</Text>
          <Text style={styles.tipBody}>{flow.tipBody}</Text>
        </View>
      </Disclose>

      {busy ? <ActivityIndicator color={colors.accent} style={{ marginTop: 12 }} /> : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
}

function ContextPhase({
  conversation,
  selectedCount,
  ignoredCount,
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
  ignoredCount: number;
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
        已选 {selectedCount} · 忽略 {ignoredCount}。点按切换；明显噪音已自动降权。
      </Meta>

      <View style={styles.timeline}>
        {conversation.messages.map((m, idx) => (
          <Pressable
            key={m.id}
            onPress={() => onToggle(m.id)}
            style={[styles.msgRow, !m.is_selected && styles.msgRowOff]}
          >
            <View style={styles.timelineRail}>
              <View style={[styles.dot, m.is_selected && styles.dotOn]} />
              {idx < conversation.messages.length - 1 ? (
                <View style={styles.rail} />
              ) : null}
            </View>
            <View style={styles.msgBody}>
              <Text style={styles.msgSender}>{m.sender}</Text>
              <Text style={styles.msgContent} numberOfLines={4}>
                {m.content}
              </Text>
              <View style={styles.msgMeta}>
                <Text style={styles.check}>{m.is_selected ? "选用" : "忽略"}</Text>
                {m.weight < 1 ? <Pill label="降权" kind="muted" /> : null}
              </View>
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
            style={[
              surfaces.filterChip,
              goal === g.id && surfaces.filterChipActive,
            ]}
          >
            <Text
              style={[
                surfaces.filterChipText,
                goal === g.id && surfaces.filterChipTextActive,
              ]}
            >
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
  conversation,
  insight,
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
  conversation: ParsedConversation;
  insight: string;
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
  const selected = conversation.messages.filter((m) => m.is_selected);
  const ignored = conversation.messages.filter((m) => !m.is_selected);
  const calendarCount = actions.filter((a) => a.type === "calendar_event").length;
  const followCount = actions.filter(
    (a) => a.type === "follow_up" || a.type === "commitment" || a.type === "task",
  ).length;

  return (
    <View style={styles.block}>
      {/* Section 1 — Alfred 理解 + replies */}
      <View style={styles.workSection}>
        <Serif size={20} style={styles.sectionHeading}>
          Alfred 理解
        </Serif>
        <View style={styles.insightCard}>
          <Text style={styles.insight}>{insight}</Text>
        </View>

        <Serif size={20} style={[styles.sectionHeading, { marginTop: 16 }]}>
          建议回复
        </Serif>
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
      </View>

      {/* Section 2 — Actions / evidence */}
      <View style={styles.workSection}>
        <Serif size={20} style={styles.sectionHeading}>
          行动 · 📅 {calendarCount} · ✓ {followCount}
        </Serif>
        {actions.length > 0 ? (
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
                                onConfirm(
                                  {
                                    ...a,
                                    suggested_time: a.suggested_time ?? "tonight",
                                  },
                                  { setReminder: true },
                                )
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
        ) : (
          <Meta>这段对话里没有明显需要跟进的行动。</Meta>
        )}
      </View>

      {/* Section 3 — Timeline context */}
      <View style={styles.workSection}>
        <Serif size={20} style={styles.sectionHeading}>
          上下文 · 选用 {selected.length} · 忽略 {ignored.length}
        </Serif>
        <View style={styles.timeline}>
          {conversation.messages.map((m, idx) => (
            <View
              key={m.id}
              style={[styles.msgRow, !m.is_selected && styles.msgRowOff]}
            >
              <View style={styles.timelineRail}>
                <View style={[styles.dot, m.is_selected && styles.dotOn]} />
                {idx < conversation.messages.length - 1 ? (
                  <View style={styles.rail} />
                ) : null}
              </View>
              <View style={styles.msgBody}>
                <Text style={styles.msgSender}>{m.sender}</Text>
                <Text style={styles.msgContent} numberOfLines={3}>
                  {m.content}
                </Text>
              </View>
            </View>
          ))}
        </View>
      </View>

      <View style={styles.footerRow}>
        <Btn label="返回调整" kind="ghost" onPress={onBack} style={{ flex: 1 }} />
        <Btn
          label="复制回复"
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
  screen: surfaces.screen,
  top: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    paddingHorizontal: layout.padX,
    paddingTop: layout.topPad,
    paddingBottom: spacing.sm,
    gap: 12,
  },
  topCopy: { flex: 1, minWidth: 0, gap: 4 },
  kicker: {
    ...surfaces.sectionKicker,
  },
  topTitle: {
    letterSpacing: -0.6,
  },
  roundTool: {
    marginTop: 4,
  },
  scroll: { flex: 1, backgroundColor: "transparent" },
  content: {
    paddingHorizontal: layout.padX,
    paddingBottom: layout.tabBarInset,
    gap: spacing.sm,
  },
  block: { gap: 4 },
  heading: { marginTop: 4, maxWidth: 320, lineHeight: 34 },
  sub: {
    fontFamily: fonts.sans,
    color: colors.ink3,
    fontSize: 13,
    lineHeight: 20,
    marginVertical: 12,
    maxWidth: 320,
  },
  pasteCard: {
    ...surfaces.glassCard,
    borderRadius: 20,
    overflow: "hidden",
    marginBottom: 4,
  },
  primaryCta: {
    ...surfaces.primaryButton,
    marginTop: 4,
    paddingHorizontal: 14,
  },
  primaryCtaDisabled: {
    opacity: 0.45,
  },
  primaryCtaText: {
    ...surfaces.primaryButtonText,
  },
  keyboardHint: {
    fontFamily: fonts.sans,
    fontSize: 11,
    lineHeight: 16,
    color: colors.ink4,
    marginTop: 10,
    marginBottom: 4,
  },
  handoffNote: {
    fontFamily: fonts.sansMedium,
    fontSize: 12,
    color: colors.accent,
    marginBottom: 6,
  },
  tipBox: {
    ...surfaces.glassCard,
    padding: 14,
    gap: 6,
  },
  tipTitle: {
    ...surfaces.sectionLabel,
  },
  tipBody: {
    fontFamily: fonts.sans,
    color: colors.ink2,
    fontSize: 13,
    lineHeight: 20,
  },
  or: {
    textAlign: "center",
    color: colors.ink4,
    fontFamily: fonts.sansSemibold,
    fontSize: 11,
    letterSpacing: 1.2,
    textTransform: "uppercase",
    marginVertical: 14,
  },
  textArea: {
    minHeight: 160,
    borderWidth: 1,
    borderColor: colors.hair,
    borderRadius: radius.card,
    padding: 16,
    backgroundColor: colors.glass,
    color: colors.ink,
    fontFamily: fonts.sans,
    fontSize: 15,
    lineHeight: 22,
    textAlignVertical: "top",
    marginBottom: 10,
    shadowColor: "#2D3D5A",
    shadowOpacity: 0.08,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
  },
  error: { color: colors.warn, fontSize: 13, marginTop: 10 },
  timeline: { marginTop: 16, gap: 0 },
  msgRow: {
    flexDirection: "row",
    gap: 10,
    paddingVertical: 6,
  },
  msgRowOff: { opacity: 0.4 },
  timelineRail: { width: 14, alignItems: "center" },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.paper3,
    marginTop: 6,
  },
  dotOn: { backgroundColor: colors.accent },
  rail: {
    flex: 1,
    width: 1,
    backgroundColor: colors.hair2,
    marginTop: 4,
    minHeight: 18,
  },
  check: {
    fontFamily: fonts.mono,
    fontSize: 10,
    letterSpacing: 0.8,
    textTransform: "uppercase",
    color: colors.ink4,
  },
  msgBody: { flex: 1, gap: 4, paddingBottom: 8 },
  msgMeta: { flexDirection: "row", alignItems: "center", gap: 8 },
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
    ...surfaces.sectionLabel,
    letterSpacing: 0.4,
    textTransform: "none",
    fontSize: 12,
  },
  sectionHeading: {
    marginBottom: 10,
    letterSpacing: -0.3,
  },
  workSection: {
    marginTop: 8,
    paddingBottom: 12,
  },
  insightCard: {
    ...surfaces.glassCard,
    borderRadius: 20,
    padding: 14,
  },
  insight: {
    fontSize: 16,
    lineHeight: 24,
    color: colors.ink,
    fontFamily: fonts.serif,
  },
  goalRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  customGoal: {
    marginTop: 10,
    borderWidth: 1,
    borderColor: colors.hair,
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: colors.glass,
    color: colors.ink,
    fontSize: 14,
  },
  actionList: { gap: 10 },
  actionCard: {
    ...surfaces.glassCard,
    borderRadius: 20,
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
    ...surfaces.glassCard,
    borderRadius: 20,
    padding: 14,
  },
  replyCardOn: {
    borderColor: colors.accent,
    backgroundColor: colors.accentSoft,
  },
  replyTone: {
    fontFamily: fonts.sansSemibold,
    fontSize: 11,
    letterSpacing: 0.4,
    color: colors.ink3,
    marginBottom: 6,
  },
  replyBody: { fontSize: 15, lineHeight: 22, color: colors.ink },
  footerRow: { flexDirection: "row", gap: 8, marginTop: 20 },
});
