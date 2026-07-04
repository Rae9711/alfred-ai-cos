// Capture — the avatar interaction space (design: docs/designs/2026-07-02-avatar-
// interaction-space.md). One unified composer (text + inline mic, no mode tabs to
// choose between first) replaces the old Speak/Type/Snap/Forward switcher — talking
// to Alfred shouldn't require picking a mode before you can start. Recording (ink
// bg, timer, animated waveform) and parsed (transcript, detected chips, extracted
// task cards) states are unchanged. Type → captureText, Voice → captureVoice (both
// real). Snap/Forward remain reachable as secondary actions, still styled stubs.
//
// Deliberately NOT a chat transcript: one capture in, one acknowledgment card back,
// no persistent back-and-forth history. A transcript view would make this visually
// indistinguishable from the Ask screen, which is exactly the "open-ended companion
// chat" boundary this space is designed to stay inside of.

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Alert,
  Animated,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import type { CaptureResponse } from "@albert/shared-types";

import { api } from "@/api/client";
import { useVoiceCapture } from "@/api/useVoiceCapture";
import {
  COMPANION_HOME_TAP_THINKING_MS,
  CompanionAvatar,
} from "@/components/CompanionAvatar";
import { Ic, AlfMark } from "@/components/icons";
import {
  Btn,
  Eyebrow,
  IconBtn,
  Pill,
  Serif,
  SerifEm,
  inputPlaceholder,
} from "@/components/ui";
import { useCompanionAvatar } from "@/context/CompanionAvatarContext";
import { useLocale } from "@/context/LocaleContext";
import { buildCaptureAcknowledgment } from "@/lib/captureAck";
import { colors, fonts, layout } from "@/theme/theme";

type Phase = "idle" | "recording" | "parsed";

export function CaptureScreen({
  onClose,
  initialText,
}: {
  onClose: () => void;
  initialText?: string;
}) {
  const { t } = useLocale();
  const [phase, setPhase] = useState<Phase>("idle");
  const [text, setText] = useState(initialText ?? "");
  const [result, setResult] = useState<CaptureResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const voice = useVoiceCapture(async (r) => {
    setResult(r);
    setPhase("parsed");
  });

  const recording = voice.state === "recording";
  const dark = phase === "recording" || recording;

  const submitText = useCallback(async () => {
    const trimmed = text.trim();
    if (!trimmed) return;
    setBusy(true);
    setError(null);
    try {
      const r = await api.captureText(trimmed);
      setResult(r);
      setPhase("parsed");
    } catch (e) {
      setError(e instanceof Error ? e.message : t.capture.parseFailed);
    } finally {
      setBusy(false);
    }
  }, [text, t.capture.parseFailed]);

  const reset = () => {
    setPhase("idle");
    setText("");
    setResult(null);
    setError(null);
  };

  // Auto-submit when invoked with an `initialText` (e.g. an iOS Shortcut sent
  // dictated text via albert://capture?text=...). The shortcut user wants the
  // capture to happen, not to land on the type box and tap submit themselves.
  useEffect(() => {
    if (initialText && initialText.trim().length > 0) {
      void submitText();
    }
    // Intentional: run once on mount per deep-link arrival. submitText is
    // stable within the closure of `text` which we already set above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <View style={[styles.screen, dark && styles.screenDark]}>
      {/* Top bar */}
      <View style={styles.top}>
        <IconBtn onPress={onClose} style={dark ? styles.iconDark : undefined}>
          <Ic.Close size={18} color={dark ? colors.paper : colors.ink2} />
        </IconBtn>
        <Eyebrow color={dark ? "rgba(255,255,255,0.6)" : colors.ink3}>
          {phase === "idle"
            ? t.capture.eyebrowIdle
            : recording
              ? t.capture.eyebrowListening
              : t.capture.eyebrowCaptured}
        </Eyebrow>
        <View style={styles.topSpacer} />
      </View>

      {phase === "parsed" && result ? (
        <ParsedState
          result={result}
          onRedo={reset}
          onDone={onClose}
        />
      ) : recording ? (
        <RecordingState onStop={() => void voice.stop()} />
      ) : (
        <IdleState
          text={text}
          setText={setText}
          busy={busy}
          error={error}
          onStartVoice={() => void voice.start()}
          onSubmitText={() => void submitText()}
        />
      )}
    </View>
  );
}

// ── Idle ─────────────────────────────────────────────────────────────────────

function IdleState({
  text,
  setText,
  busy,
  error,
  onStartVoice,
  onSubmitText,
}: {
  text: string;
  setText: (t: string) => void;
  busy: boolean;
  error: string | null;
  onStartVoice: () => void;
  onSubmitText: () => void;
}) {
  const { t } = useLocale();
  const { meta, state } = useCompanionAvatar();
  const [avatarTapFlash, setAvatarTapFlash] = useState(false);
  const avatarTapPending = useRef(false);

  const onAvatarPress = useCallback(() => {
    if (avatarTapPending.current) return;
    avatarTapPending.current = true;
    setAvatarTapFlash(true);
    setTimeout(() => {
      onStartVoice();
      setAvatarTapFlash(false);
      avatarTapPending.current = false;
    }, COMPANION_HOME_TAP_THINKING_MS);
  }, [onStartVoice]);

  return (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={styles.idleContent}
      keyboardShouldPersistTaps="handled"
    >
      <View style={styles.idleTitle}>
        <Serif size={30} style={styles.idleHeading}>
          {t.capture.idleTitlePlain}{" "}
          <SerifEm>{t.capture.idleTitleEm}</SerifEm>.
        </Serif>
      </View>

      <View style={styles.avatarRow}>
        <CompanionAvatar
          size={160}
          level={meta.level}
          color={meta.color}
          state={avatarTapFlash ? "thinking" : state}
          onPress={onAvatarPress}
          accessibilityLabel={t.a11y.captureHome}
        />
      </View>

      <Text style={styles.idleSub}>{t.capture.idleSub}</Text>

      <UnifiedComposer
        text={text}
        setText={setText}
        busy={busy}
        onStartVoice={onStartVoice}
        onSubmit={onSubmitText}
      />

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <SecondaryActions />

      <View style={styles.listenFor}>
        <View style={styles.listenHead}>
          <AlfMark size={12} color={colors.accent} />
          <Text style={styles.listenLabel}>{t.capture.listenFor}</Text>
        </View>
        <View style={styles.chipRow}>
          {[
            {
              label: t.capture.chipDates,
              icon: <Ic.Calendar size={11} color={colors.ink3} stroke={1.8} />,
            },
            {
              label: t.capture.chipPeople,
              icon: <Ic.User size={11} color={colors.ink3} stroke={1.8} />,
            },
            {
              label: t.capture.chipTasks,
              icon: <Ic.Check size={11} color={colors.ink3} stroke={2.4} />,
            },
            {
              label: t.capture.chipProjects,
              icon: <Ic.Stack size={11} color={colors.ink3} stroke={1.8} />,
            },
            {
              label: t.capture.chipDecisions,
              icon: <Ic.Bell size={11} color={colors.ink3} stroke={1.8} />,
            },
          ].map((c) => (
            <Pill
              key={c.label}
              label={c.label}
              kind="muted"
              mono={false}
              leading={c.icon}
            />
          ))}
        </View>
      </View>
    </ScrollView>
  );
}

// One composer, not a mode switcher: text is always the primary surface, the mic
// is an inline alternative for when speaking is easier than typing. Tapping the
// mic hands off to the existing RecordingState (unchanged) rather than opening a
// separate "voice mode" idle screen — there's nothing to switch into or out of.
function UnifiedComposer({
  text,
  setText,
  busy,
  onStartVoice,
  onSubmit,
}: {
  text: string;
  setText: (t: string) => void;
  busy: boolean;
  onStartVoice: () => void;
  onSubmit: () => void;
}) {
  const { t } = useLocale();
  return (
    <View style={styles.composer}>
      <View style={styles.composerInputRow}>
        <TextInput
          value={text}
          onChangeText={setText}
          placeholder={t.capture.composerPlaceholder}
          placeholderTextColor={inputPlaceholder}
          multiline
          style={styles.composerInput}
        />
        <Pressable
          style={styles.composerMic}
          onPress={onStartVoice}
          accessibilityLabel={t.capture.micA11y}
        >
          <Ic.Mic size={20} color="#fff" stroke={1.6} />
        </Pressable>
      </View>
      <Btn
        label={busy ? t.capture.composerParsing : t.capture.composerSubmit}
        kind="accent"
        full
        disabled={busy || !text.trim()}
        onPress={onSubmit}
      />
    </View>
  );
}

// Snap and Forward stay reachable but demoted to compact secondary actions,
// not full modes competing with the primary composer for attention.
function SecondaryActions() {
  const { t } = useLocale();
  return (
    <View style={styles.secondaryRow}>
      <Pressable
        style={styles.secondaryAction}
        onPress={() =>
          Alert.alert(t.capture.snapSoonTitle, t.capture.snapSoonBody)
        }
      >
        <Ic.Image size={14} color={colors.ink3} stroke={1.6} />
        <Text style={styles.secondaryActionLabel}>{t.capture.snapLabel}</Text>
      </Pressable>
      <Pressable
        style={styles.secondaryAction}
        onPress={() =>
          Alert.alert(t.capture.forwardSoonTitle, t.capture.forwardSoonBody)
        }
      >
        <Ic.Forward size={14} color={colors.ink3} stroke={1.6} />
        <Text style={styles.secondaryActionLabel}>{t.capture.forwardLabel}</Text>
      </Pressable>
    </View>
  );
}

// ── Recording ──────────────────────────────────────────────────────────────

function RecordingState({ onStop }: { onStop: () => void }) {
  const { t } = useLocale();
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setElapsed((e) => e + 0.1), 100);
    return () => clearInterval(t);
  }, []);
  return (
    <View style={styles.recording}>
      <View style={styles.recTop}>
        <Text style={styles.recListening}>{t.capture.eyebrowListening}</Text>
        <Serif size={38} color="#fff" style={styles.recTimer}>
          {elapsed.toFixed(1)}
          <Text style={styles.recTimerUnit}>s</Text>
        </Serif>
      </View>
      <Waveform />
      <Serif
        size={14}
        italic
        color="rgba(255,255,255,0.7)"
        style={styles.recHint}
      >
        {t.capture.recordingHint}
      </Serif>
      <Pressable
        style={styles.stopBtn}
        onPress={onStop}
        accessibilityLabel={t.capture.stopA11y}
      >
        <View style={styles.stopSquare} />
      </Pressable>
    </View>
  );
}

function Waveform() {
  const bars = useRef(
    Array.from({ length: 32 }, () => new Animated.Value(0.3)),
  ).current;
  useEffect(() => {
    const loops = bars.map((b, i) =>
      Animated.loop(
        Animated.sequence([
          Animated.timing(b, {
            toValue: 1,
            duration: 400 + (i % 5) * 90,
            useNativeDriver: false,
          }),
          Animated.timing(b, {
            toValue: 0.25,
            duration: 400 + (i % 7) * 80,
            useNativeDriver: false,
          }),
        ]),
      ),
    );
    loops.forEach((l, i) => setTimeout(() => l.start(), i * 30));
    return () => loops.forEach((l) => l.stop());
  }, [bars]);

  return (
    <View style={styles.waveform}>
      {bars.map((b, i) => (
        <Animated.View
          key={i}
          style={[
            styles.waveBar,
            {
              height: b.interpolate({
                inputRange: [0, 1],
                outputRange: [6, 56],
              }),
              opacity: b.interpolate({
                inputRange: [0, 1],
                outputRange: [0.5, 1],
              }),
            },
          ]}
        />
      ))}
    </View>
  );
}

// ── Parsed ───────────────────────────────────────────────────────────────────

function ParsedState({
  result,
  onRedo,
  onDone,
}: {
  result: CaptureResponse;
  onRedo: () => void;
  onDone: () => void;
}) {
  const { t } = useLocale();
  const tasks = result.tasks;
  const acknowledgment = buildCaptureAcknowledgment(result, t.capture);
  return (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={styles.parsedContent}
    >
      <Serif size={26} style={styles.parsedHeading}>
        {acknowledgment}
      </Serif>

      {result.detected_project ? (
        <View style={styles.chips}>
          <Pill
            label={result.detected_project}
            kind="accent"
            leading={<Ic.Stack size={9} color={colors.accentInk} stroke={2} />}
          />
        </View>
      ) : null}

      {tasks.length > 0 ? (
        <>
          <Text style={styles.parsedSection}>{t.capture.resultSection}</Text>
          <View style={styles.taskList}>
            {tasks.map((task, i) => (
              <View key={task.id} style={styles.taskCard}>
                <View style={styles.taskNum}>
                  <Text style={styles.taskNumText}>{i + 1}</Text>
                </View>
                <View style={styles.taskBody}>
                  <Text style={styles.taskTitle}>{task.title}</Text>
                  <View style={styles.taskMeta}>
                    {task.due_date ? (
                      <Pill label={task.due_date} kind="warn" />
                    ) : null}
                    {task.remind_at ? (
                      <Pill label={task.remind_at} kind="muted" />
                    ) : null}
                  </View>
                </View>
              </View>
            ))}
          </View>
        </>
      ) : null}

      <View style={styles.parsedActions}>
        <Btn
          label={t.capture.redo}
          kind="ghost"
          onPress={onRedo}
          style={styles.redoBtn}
          leading={<Ic.Refresh size={12} color={colors.ink2} />}
        />
        <Btn
          label={t.capture.done}
          kind="accent"
          onPress={onDone}
          style={styles.addBtn}
          leading={<Ic.Check size={12} color="#fff" stroke={2.4} />}
        />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.paper },
  screenDark: { backgroundColor: colors.ink },
  top: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: layout.padX,
    paddingTop: layout.topPad,
    paddingBottom: 8,
  },
  iconDark: {
    backgroundColor: "rgba(255,255,255,0.08)",
    borderColor: "rgba(255,255,255,0.18)",
  },
  topSpacer: { width: 36 },
  scroll: { flex: 1 },

  idleContent: { paddingHorizontal: layout.padX, paddingBottom: 24 },
  idleTitle: { paddingTop: 16, paddingBottom: 8, alignItems: "center" },
  idleHeading: { maxWidth: 300, lineHeight: 32, textAlign: "center" },
  avatarRow: { alignItems: "center", marginVertical: 8 },
  idleSub: {
    color: colors.ink3,
    marginTop: 4,
    marginBottom: 16,
    fontSize: 14,
    lineHeight: 21,
    textAlign: "center",
  },

  composer: { gap: 10 },
  composerInputRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 8,
  },
  composerInput: {
    flex: 1,
    minHeight: 96,
    maxHeight: 180,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.hair2,
    borderRadius: 16,
    padding: 14,
    backgroundColor: colors.card,
    color: colors.ink,
    fontSize: 15,
    lineHeight: 23,
    textAlignVertical: "top",
  },
  composerMic: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.accent,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: colors.accent,
    shadowOpacity: 0.28,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
  },

  secondaryRow: {
    flexDirection: "row",
    gap: 16,
    marginTop: 14,
  },
  secondaryAction: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  secondaryActionLabel: {
    fontSize: 13,
    color: colors.ink3,
  },

  error: { color: colors.warn, fontSize: 13, marginTop: 12 },

  listenFor: {
    marginTop: 18,
    paddingTop: 16,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.hair,
  },
  listenHead: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginBottom: 10,
  },
  listenLabel: {
    fontFamily: fonts.mono,
    fontSize: 10,
    letterSpacing: 1.4,
    textTransform: "uppercase",
    color: colors.ink4,
  },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 6 },

  recording: {
    flex: 1,
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: layout.padX,
    paddingVertical: 40,
  },
  recTop: { alignItems: "center", marginTop: 20, gap: 12 },
  recListening: {
    fontFamily: fonts.mono,
    fontSize: 11,
    letterSpacing: 1.4,
    textTransform: "uppercase",
    color: "rgba(255,255,255,0.55)",
  },
  recTimer: { letterSpacing: -0.4 },
  recTimerUnit: { color: "rgba(255,255,255,0.4)" },
  recHint: { textAlign: "center", maxWidth: 260, lineHeight: 21 },
  waveform: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    height: 80,
  },
  waveBar: { width: 3, borderRadius: 100, backgroundColor: "#8aa0cf" },
  stopBtn: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: "#fff",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOpacity: 0.4,
    shadowRadius: 40,
    shadowOffset: { width: 0, height: 12 },
  },
  stopSquare: {
    width: 28,
    height: 28,
    borderRadius: 6,
    backgroundColor: colors.accent,
  },

  parsedContent: { paddingHorizontal: layout.padX, paddingBottom: 30 },
  parsedHeading: { marginTop: 8, lineHeight: 32 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 14 },
  parsedSection: {
    fontSize: 13,
    fontWeight: "500",
    letterSpacing: 0.78,
    textTransform: "uppercase",
    color: colors.ink3,
    marginTop: 22,
    marginBottom: 8,
  },
  taskList: { gap: 8 },
  taskCard: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    backgroundColor: colors.card,
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.hair,
    padding: 14,
  },
  taskNum: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: colors.accentSoft,
    alignItems: "center",
    justifyContent: "center",
  },
  taskNumText: {
    fontFamily: fonts.mono,
    fontSize: 11,
    color: colors.accentInk,
  },
  taskBody: { flex: 1, minWidth: 0 },
  taskTitle: { fontSize: 15, lineHeight: 20, color: colors.ink },
  taskMeta: {
    flexDirection: "row",
    gap: 6,
    marginTop: 6,
    alignItems: "center",
  },
  parsedActions: { flexDirection: "row", gap: 8, marginTop: 20 },
  redoBtn: { flex: 1 },
  addBtn: { flex: 2 },
});
