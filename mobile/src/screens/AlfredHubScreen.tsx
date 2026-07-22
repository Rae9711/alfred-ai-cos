// Alfred hub — center-tab assistant: schedule / SMS / reminder / capture + email NL.

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
import { CaptureScreen } from "@/screens/CaptureScreen";
import { colors, fonts, layout, radius, spacing } from "@/theme/theme";

type HubMode = "idle" | "schedule" | "sms" | "reminder" | "capture";

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

  const [mode, setMode] = useState<HubMode>(
    startInCapture ? "capture" : "idle",
  );
  const [captureText, setCaptureText] = useState(initialCaptureText);
  const [captureKey, setCaptureKey] = useState(0);

  const greeting = greetingForLocale(new Date().getHours(), locale);
  const hub = t.alfredHub;

  const beginSmsFlowRef = useRef(chat.beginSmsFlow);
  const setInputRef = useRef(chat.setInput);
  beginSmsFlowRef.current = chat.beginSmsFlow;
  setInputRef.current = chat.setInput;
  const seedReminder = hub.seedReminder;

  const applyLaunch = useCallback((opts: AlfredLaunchOpts) => {
    if (opts.capture || opts.mode === "capture") {
      setCaptureText(opts.text);
      setCaptureKey((k) => k + 1);
      setMode("capture");
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

  const onAction = (key: HubMode) => {
    if (key === "capture") {
      setCaptureText(undefined);
      setCaptureKey((k) => k + 1);
      setMode("capture");
      return;
    }
    setMode(key);
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

  const actions: { key: HubMode; label: string }[] = [
    { key: "schedule", label: hub.actionSchedule },
    { key: "sms", label: hub.actionSms },
    { key: "reminder", label: hub.actionReminder },
    { key: "capture", label: hub.actionCapture },
  ];

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
        <Eyebrow>{hub.eyebrow}</Eyebrow>
        <View style={styles.hero}>
          <AlfredMiniAvatar size={112} accessibilityLabel="Alfred" />
          <Serif size={36} display style={styles.greeting}>
            {greeting} <SerifEm>{hub.butlerName}</SerifEm>
          </Serif>
          <Text style={styles.sub}>{hub.sub}</Text>
        </View>

        <View style={styles.actions}>
          {actions.map((a) => {
            const active = mode === a.key;
            const primary = a.key === "schedule";
            return (
              <Pressable
                key={a.key}
                onPress={() => onAction(a.key)}
                style={[
                  styles.actionChip,
                  primary && styles.actionChipPrimary,
                  active && styles.actionChipActive,
                ]}
              >
                <Text
                  style={[
                    styles.actionLabel,
                    primary && !active && styles.actionLabelPrimary,
                    active && styles.actionLabelActive,
                  ]}
                >
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
          <TextInput
            style={styles.composer}
            value={chat.input}
            onChangeText={chat.setInput}
            placeholder={chat.placeholder}
            placeholderTextColor={inputPlaceholder}
            multiline
            keyboardType={chat.keyboardType}
            onSubmitEditing={() => chat.sendFree(chat.input)}
          />
          <AlfredIcon
            icon={Ic.ArrowUp}
            variant="dark"
            size="small"
            label={t.a11y.send}
            onPress={() => chat.sendFree(chat.input)}
          />
          {Platform.OS === "android" ? (
            chat.voice.state !== "idle" ? (
              <AlfredIcon
                variant="assistant"
                size="small"
                label="Voice input"
                onPress={() => void chat.voice.stop()}
              >
                <ActivityIndicator size="small" color="#fff" />
              </AlfredIcon>
            ) : (
              <AlfredIcon
                icon={Ic.Mic}
                variant="assistant"
                size="small"
                label="Voice input"
                onPress={() => void chat.voice.start()}
              />
            )
          ) : null}
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
    gap: spacing.sm,
    paddingVertical: spacing.lg,
    marginHorizontal: -layout.padX,
    paddingHorizontal: layout.padX,
    backgroundColor: "transparent",
    marginBottom: spacing.sm,
  },
  greeting: { textAlign: "center" },
  sub: {
    fontFamily: fonts.sans,
    fontSize: 13,
    lineHeight: 19,
    color: colors.ink3,
    textAlign: "center",
    maxWidth: 280,
    letterSpacing: 0.1,
  },
  actions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    justifyContent: "center",
    marginTop: spacing.sm,
  },
  actionChip: {
    borderWidth: 1,
    borderColor: colors.hair,
    borderRadius: radius.pill,
    paddingHorizontal: 14,
    paddingVertical: 9,
    backgroundColor: colors.glassSoft,
  },
  actionChipPrimary: {
    backgroundColor: colors.accentSoft,
    borderColor: "rgba(47,102,200,0.28)",
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  actionChipActive: {
    borderColor: colors.accent,
    backgroundColor: colors.accentWell,
  },
  actionLabel: {
    fontFamily: fonts.sansMedium,
    fontSize: 12,
    letterSpacing: 0.2,
    color: colors.ink3,
  },
  actionLabelPrimary: {
    fontFamily: fonts.sansSemibold,
    color: colors.accentInk,
    fontSize: 12,
  },
  actionLabelActive: { color: colors.accentDeep },
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
    borderTopWidth: 0,
    paddingHorizontal: layout.padX,
    paddingTop: 8,
    paddingBottom: 12,
    backgroundColor: "transparent",
  },
  composerInner: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 8,
    backgroundColor: colors.glass,
    borderRadius: 24,
    paddingVertical: 6,
    paddingLeft: 14,
    paddingRight: 6,
    borderWidth: 1,
    borderColor: colors.hair,
    shadowColor: "#2D3D5A",
    shadowOpacity: 0.1,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
  },
  composer: {
    flex: 1,
    minHeight: 36,
    maxHeight: 120,
    fontFamily: fonts.sans,
    fontSize: 15,
    lineHeight: 22,
    color: colors.ink,
    paddingVertical: 6,
  },
});
