// Alfred hub — center-tab assistant: schedule / email / SMS / reminder (+ capture via deep link).

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
import AlfredMiniAvatar from "@/components/AlfredMiniAvatar";
import { AlfredIcon } from "@/components/AlfredIcon";
import { Ic } from "@/components/icons";
import { ScreenWash } from "@/components/ScreenWash";
import { Btn, Eyebrow, Serif, SerifEm, inputPlaceholder } from "@/components/ui";
import { useLocale } from "@/context/LocaleContext";
import { useShell } from "@/components/Shell";
import {
  useAlfredFreeChat,
  type AlfredFreeMsg,
} from "@/hooks/useAlfredFreeChat";
import { greetingForLocale } from "@/i18n/locales";
import {
  consumeAlfredLaunchOpts,
  subscribeAlfredLaunch,
  type AlfredLaunchOpts,
} from "@/lib/alfredLaunch";
import { openSmsCompose } from "@/lib/sms";
import { firstNameOf, greetingFor } from "@/lib/today";
import { CaptureScreen } from "@/screens/CaptureScreen";
import { colors, fonts, layout, spacing } from "@/theme/theme";
import { surfaces } from "@/theme/surfaces";
import type { Me } from "@albert/shared-types";

type HubMode = "idle" | "schedule" | "email" | "sms" | "reminder" | "capture";

export function AlfredHubScreen({
  initialCaptureText,
  startInCapture,
}: {
  initialCaptureText?: string;
  startInCapture?: boolean;
} = {}) {
  const { t, locale } = useLocale();
  const { showToast } = useShell();
  const scrollRef = useRef<ScrollView>(null);
  const chat = useAlfredFreeChat(scrollRef);

  const [me, setMe] = useState<Me | null>(null);
  const [mode, setMode] = useState<HubMode>(
    startInCapture ? "capture" : "idle",
  );
  const [captureText, setCaptureText] = useState(initialCaptureText);
  const [captureKey, setCaptureKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    void api
      .getMe()
      .then((profile) => {
        if (!cancelled) setMe(profile);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const greeting =
    locale === "zh"
      ? greetingForLocale(new Date().getHours(), locale)
      : greetingFor(new Date().getHours());
  const displayName =
    firstNameOf(me?.name) ?? me?.email.split("@")[0] ?? "there";
  const hub = t.alfredHub;

  const beginSmsFlowRef = useRef(chat.beginSmsFlow);
  const beginEmailFlowRef = useRef(chat.beginEmailFlow);
  const setInputRef = useRef(chat.setInput);
  beginSmsFlowRef.current = chat.beginSmsFlow;
  beginEmailFlowRef.current = chat.beginEmailFlow;
  setInputRef.current = chat.setInput;
  const seedReminder = hub.seedReminder;

  const applyLaunch = useCallback((opts: AlfredLaunchOpts) => {
    if (opts.capture || opts.mode === "capture") {
      setCaptureText(opts.text);
      setCaptureKey((k) => k + 1);
      setMode("capture");
      return;
    }
    if (opts.mode === "email") {
      setMode("email");
      if (opts.text?.trim()) {
        chat.sendFreeRef.current(opts.text.trim());
      } else {
        beginEmailFlowRef.current();
      }
      return;
    }
    if (opts.mode === "sms") {
      setMode("sms");
      // Prefill from Home / deep link: run free-chat SMS parse instead of empty "who?" prompt.
      if (opts.text?.trim()) {
        chat.sendFreeRef.current(opts.text.trim());
      } else {
        beginSmsFlowRef.current();
      }
      return;
    }
    if (opts.mode === "reminder") {
      setMode("reminder");
      setInputRef.current(opts.seed ?? seedReminder);
      return;
    }
    if (opts.mode === "schedule") {
      setMode("schedule");
      if (opts.seed) setInputRef.current(opts.seed);
      return;
    }
    if (opts.seed) {
      setInputRef.current(opts.seed);
    }
    if (opts.text?.trim()) {
      chat.sendFreeRef.current(opts.text.trim());
    }
  }, [chat.sendFreeRef, seedReminder]);

  useEffect(() => {
    const pending = consumeAlfredLaunchOpts();
    if (pending) applyLaunch(pending);
    return subscribeAlfredLaunch(() => {
      const next = consumeAlfredLaunchOpts();
      if (next) applyLaunch(next);
    });
  }, [applyLaunch]);

  // Honor mount props once (deep link via tabs remount / parent key).
  useEffect(() => {
    if (startInCapture) {
      setMode("capture");
      setCaptureText(initialCaptureText);
      setCaptureKey((k) => k + 1);
    } else if (initialCaptureText?.trim()) {
      chat.sendFreeRef.current(initialCaptureText.trim());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-only props
  }, []);

  const onAction = (key: Exclude<HubMode, "idle" | "capture">) => {
    setMode(key);
    if (key === "email") {
      chat.beginEmailFlow();
      return;
    }
    if (key === "sms") {
      chat.beginSmsFlow();
      return;
    }
    if (key === "reminder") {
      chat.setInput(hub.seedReminder);
      return;
    }
    if (key === "schedule") {
      chat.setInput("");
    }
  };

  const scheduleExamples = t.askHintGroups[0]?.examples ?? [];

  if (mode === "capture") {
    return (
      <CaptureScreen
        key={captureKey}
        initialText={captureText}
        onClose={() => setMode("idle")}
      />
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={Platform.OS === "ios" ? layout.tabBarInset : 0}
    >
      <ScreenWash />
      <ScrollView
        ref={scrollRef}
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
        onContentSizeChange={() =>
          scrollRef.current?.scrollToEnd({ animated: true })
        }
      >
        <View style={styles.hero}>
          <Eyebrow>{hub.eyebrow}</Eyebrow>
          <AlfredMiniAvatar size={112} accessibilityLabel="Alfred" />
          <Serif size={32} display style={styles.greeting}>
            {greeting} <SerifEm>{displayName}</SerifEm>
          </Serif>
          <Text style={styles.sub}>{hub.sub}</Text>
        </View>

        <View style={styles.actions}>
          {(
            [
              { key: "schedule" as const, label: hub.actionSchedule, icon: Ic.Calendar, tone: "blue" as const },
              { key: "email" as const, label: hub.actionEmail, icon: Ic.Mail, tone: "purple" as const },
              { key: "sms" as const, label: hub.actionSms, icon: Ic.Chat, tone: "green" as const },
              { key: "reminder" as const, label: hub.actionReminder, icon: Ic.Bell, tone: "yellow" as const },
            ] as const
          ).map((a) => {
            const active = mode === a.key;
            return (
              <Pressable
                key={a.key}
                onPress={() => onAction(a.key)}
                style={[styles.hubChip, active && styles.hubChipActive]}
              >
                <AlfredIcon icon={a.icon} tone={a.tone} size="small" />
                <Text style={[styles.hubChipLabel, active && styles.hubChipLabelActive]}>
                  {a.label}
                </Text>
              </Pressable>
            );
          })}
        </View>

        {mode !== "idle" ? (
          <Text style={styles.modeHint}>
            {mode === "schedule"
              ? hub.hintSchedule
              : mode === "email"
                ? hub.hintEmail
                : mode === "sms"
                  ? hub.hintSms
                  : hub.hintReminder}
          </Text>
        ) : null}

        {mode === "schedule" && chat.freeChat.length <= 1 && !chat.thinking
          ? scheduleExamples.map((q) => (
              <Pressable
                key={q}
                style={styles.suggestItem}
                onPress={() => chat.sendFree(q)}
              >
                <Serif size={14} italic color={colors.ink2}>
                  "{q}"
                </Serif>
                <View style={styles.suggestArrow}>
                  <Ic.Arrow size={12} color={colors.ink3} />
                </View>
              </Pressable>
            ))
          : null}

        {chat.freeChat.map((m, i) => (
          <FreeBubble
            key={i}
            msg={m}
            onOpenSms={(phone, body) => {
              openSmsCompose(phone, body);
              showToast(t.ask.smsOpened);
            }}
            onSendEmail={(composeId) => chat.sendEmailDraft(composeId)}
            openLabel={t.smsCompose.openInMessages}
            sendEmailLabel={t.emailCompose.sendFromGmail}
            sendingEmailLabel={t.emailCompose.sending}
          />
        ))}
        {chat.thinking ? (
          <Text style={styles.thinking}>{t.ask.thinking}</Text>
        ) : null}
      </ScrollView>

      <View style={styles.composerWrap}>
        <View style={styles.composerInner}>
          {chat.voice.state === "uploading" ? (
            <Pressable
              style={styles.composerIconBtn}
              disabled
              accessibilityLabel={t.a11y.voiceInput}
            >
              <ActivityIndicator size="small" color={colors.accent} />
            </Pressable>
          ) : chat.voice.state === "recording" ? (
            <Pressable
              style={[styles.composerIconBtn, styles.composerMicActive]}
              onPress={() => void chat.voice.stop()}
              accessibilityLabel={t.a11y.voiceStop}
            >
              <Ic.Mic size={17} color="#FFFFFF" stroke={2} />
            </Pressable>
          ) : (
            <Pressable
              style={styles.composerIconBtn}
              onPress={() => void chat.voice.start()}
              accessibilityLabel={t.a11y.voiceInput}
            >
              <Ic.Mic size={17} color="#60708D" stroke={2} />
            </Pressable>
          )}
          <TextInput
            style={styles.composer}
            value={chat.input}
            onChangeText={chat.setInput}
            placeholder={chat.placeholder || hub.composerPlaceholder}
            placeholderTextColor={inputPlaceholder}
            multiline
            keyboardType={chat.keyboardType}
            onSubmitEditing={() => chat.sendFree(chat.input)}
          />
          <Pressable
            style={styles.sendBtn}
            onPress={() => chat.sendFree(chat.input)}
            accessibilityLabel={t.a11y.send}
          >
            <Ic.Send size={15} color="#FFFFFF" stroke={2} />
          </Pressable>
          <Pressable style={styles.composerIconBtn} accessibilityLabel="Alfred">
            <Ic.Sparkles size={17} color="#60708D" stroke={2} />
          </Pressable>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

function FreeBubble({
  msg,
  onOpenSms,
  onSendEmail,
  openLabel,
  sendEmailLabel,
  sendingEmailLabel,
}: {
  msg: AlfredFreeMsg;
  onOpenSms?: (phone: string, body: string) => void;
  onSendEmail?: (composeId: string) => void;
  openLabel: string;
  sendEmailLabel: string;
  sendingEmailLabel: string;
}) {
  const isAlf = msg.role === "alfred";
  return (
    <View style={[styles.bubbleWrap, isAlf ? styles.left : styles.right]}>
      {isAlf ? (
        <>
          <View style={styles.hubBubble}>
            <Text style={styles.alfText}>{msg.text}</Text>
          </View>
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
          {msg.emailDraft ? (
            <View style={styles.smsDraftCard}>
              <Text style={styles.smsDraftTo}>
                {msg.emailDraft.name} · {msg.emailDraft.email}
              </Text>
              <Text style={styles.emailDraftSubject}>
                {msg.emailDraft.subject}
              </Text>
              <Text style={styles.smsDraftBody}>{msg.emailDraft.body}</Text>
              <Btn
                label={
                  msg.emailDraft.sending ? sendingEmailLabel : sendEmailLabel
                }
                onPress={() => onSendEmail?.(msg.emailDraft!.composeId)}
                disabled={msg.emailDraft.sending}
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
  screen: { flex: 1, backgroundColor: colors.washBottom },
  scroll: {
    paddingHorizontal: layout.padX,
    paddingTop: layout.topPad,
    paddingBottom: spacing.lg,
    gap: spacing.sm,
    backgroundColor: "transparent",
  },
  hero: {
    alignItems: "center",
    gap: 10,
    paddingVertical: 12,
    paddingHorizontal: 8,
  },
  greeting: { textAlign: "center", letterSpacing: -0.8 },
  sub: {
    fontFamily: fonts.sans,
    fontSize: 13,
    lineHeight: 20,
    color: colors.ink3,
    textAlign: "center",
    maxWidth: 280,
  },
  actions: {
    flexDirection: "row",
    gap: 8,
    width: "100%",
    marginTop: 4,
  },
  hubChip: {
    flex: 1,
    alignItems: "center",
    gap: 6,
    backgroundColor: "transparent",
  },
  hubChipActive: {
    opacity: 1,
  },
  hubChipLabel: {
    fontFamily: fonts.sansMedium,
    fontSize: 10,
    color: "#465574",
  },
  hubChipLabelActive: {
    color: colors.accent,
    fontFamily: fonts.sansSemibold,
  },
  modeHint: {
    fontFamily: fonts.sans,
    fontSize: 13,
    lineHeight: 18,
    color: colors.ink3,
    textAlign: "center",
    marginTop: spacing.xs,
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
    shadowColor: "#2D3D5A",
    shadowOpacity: 0.05,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
  },
  suggestArrow: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.paper2,
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
  alfText: {
    fontFamily: fonts.serif,
    fontSize: 15,
    lineHeight: 23,
    color: colors.ink,
  },
  hubBubble: {
    ...surfaces.glassCard,
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 20,
  },
  smsDraftCard: {
    marginTop: 12,
    padding: 14,
    backgroundColor: colors.card,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.hair2,
    gap: 10,
  },
  smsDraftTo: { fontFamily: fonts.sans, fontSize: 13, color: colors.ink3 },
  emailDraftSubject: {
    fontFamily: fonts.sansMedium,
    fontSize: 14,
    color: colors.ink,
  },
  smsDraftBody: {
    fontFamily: fonts.sans,
    fontSize: 15,
    lineHeight: 22,
    color: colors.ink2,
  },
  userBubble: {
    backgroundColor: colors.ink,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 18,
  },
  userText: {
    fontFamily: fonts.sans,
    color: colors.paper,
    fontSize: 14.5,
    lineHeight: 21,
  },
  composerWrap: {
    paddingHorizontal: layout.padX,
    paddingTop: 8,
    paddingBottom: layout.tabBarInset,
    backgroundColor: "transparent",
  },
  composerInner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: colors.glass,
    borderRadius: 18,
    paddingVertical: 7,
    paddingHorizontal: 7,
    borderWidth: 1,
    borderColor: colors.hair,
    shadowColor: "#2D3D5A",
    shadowOpacity: 0.1,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
  },
  composerIconBtn: {
    width: 32,
    height: 32,
    alignItems: "center",
    justifyContent: "center",
  },
  composerMicActive: {
    borderRadius: 16,
    backgroundColor: colors.accent,
  },
  sendBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.accent,
    alignItems: "center",
    justifyContent: "center",
  },
  composer: {
    flex: 1,
    minHeight: 32,
    maxHeight: 100,
    fontFamily: fonts.sans,
    fontSize: 13,
    lineHeight: 18,
    color: colors.ink,
    paddingVertical: 6,
  },
});
