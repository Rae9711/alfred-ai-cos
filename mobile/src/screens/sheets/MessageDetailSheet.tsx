// Full email body for inbox preview before replying.

import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { api } from "@/api/client";
import { Btn } from "@/components/ui";
import { useLocale } from "@/context/LocaleContext";
import { colors, fonts, layout, radius } from "@/theme/theme";

type Props = {
  messageId: string;
  isUnread?: boolean;
  onReply: () => void;
  onMarkRead?: () => void;
  onClose: () => void;
};

export function MessageDetailSheet({
  messageId,
  isUnread = false,
  onReply,
  onMarkRead,
  onClose,
}: Props) {
  const { t } = useLocale();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [subject, setSubject] = useState("");
  const [sender, setSender] = useState("");
  const [summary, setSummary] = useState<string | null>(null);
  const [body, setBody] = useState("");
  const [read, setRead] = useState(!isUnread);
  const [isSms, setIsSms] = useState(false);

  useEffect(() => {
    setRead(!isUnread);
  }, [isUnread, messageId]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setLoading(true);
      setError(null);
      try {
        const detail = await api.getMessage(messageId);
        if (cancelled) return;
        setSubject(detail.subject?.trim() || (detail.source === "sms" ? t.sms.messageLabel : "(No subject)"));
        setSender(detail.sender);
        setSummary(detail.take?.trim() || null);
        const bodyText = detail.body?.trim() || detail.snippet?.trim() || "";
        setBody(bodyText);
        setIsSms(detail.source === "sms");
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Couldn't load email");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [messageId]);

  const handleMarkRead = () => {
    if (read) return;
    setRead(true);
    onMarkRead?.();
  };

  return (
    <View style={styles.sheet}>
      <View style={styles.header}>
        <Text style={styles.label}>
          {isSms ? t.sms.messageLabel : t.ask.originalEmail}
        </Text>
        <Pressable onPress={onClose} hitSlop={12}>
          <Text style={styles.close}>{t.ask.cancel}</Text>
        </Pressable>
      </View>

      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator color={colors.accent} />
          <Text style={styles.loadingText}>{t.ask.loadingEmail}</Text>
        </View>
      ) : error ? (
        <Text style={styles.error}>{error}</Text>
      ) : (
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator
        >
          <Text style={styles.subject}>{subject}</Text>
          <Text style={styles.from}>{sender}</Text>
          {summary ? (
            <View style={styles.summaryBox}>
              <Text style={styles.summaryLabel}>{t.ask.albertSummary}</Text>
              <Text style={styles.summaryText}>{summary}</Text>
            </View>
          ) : null}
          <Text style={styles.body}>{body}</Text>
        </ScrollView>
      )}

      <View style={styles.footer}>
        {!read && !isSms ? (
          <Pressable style={styles.markReadBtn} onPress={handleMarkRead}>
            <Text style={styles.markReadText}>{t.inbox.markReadAction}</Text>
          </Pressable>
        ) : null}
        <Btn label={t.inbox.reply} onPress={onReply} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  sheet: {
    maxHeight: "88%",
    backgroundColor: colors.paper,
    borderTopLeftRadius: radius.card,
    borderTopRightRadius: radius.card,
    paddingBottom: layout.padX,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: layout.padX,
    paddingTop: 16,
    paddingBottom: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.hair,
  },
  label: {
    fontFamily: fonts.mono,
    fontSize: 10,
    letterSpacing: 1.4,
    textTransform: "uppercase",
    color: colors.ink4,
  },
  close: { fontSize: 14, color: colors.ink3 },
  centered: {
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    paddingVertical: 40,
  },
  loadingText: { fontSize: 13, color: colors.ink3 },
  error: { color: colors.warn, fontSize: 14, padding: layout.padX },
  scroll: { flexGrow: 0 },
  scrollContent: {
    paddingHorizontal: layout.padX,
    paddingTop: 14,
    paddingBottom: 20,
    gap: 10,
  },
  subject: { fontSize: 18, fontWeight: "600", color: colors.ink },
  from: { fontSize: 13, color: colors.ink3 },
  summaryBox: {
    padding: 10,
    backgroundColor: colors.paper2,
    borderRadius: 10,
    gap: 4,
  },
  summaryLabel: {
    fontFamily: fonts.mono,
    fontSize: 10,
    letterSpacing: 1,
    textTransform: "uppercase",
    color: colors.ink4,
  },
  summaryText: { fontSize: 13, lineHeight: 19, color: colors.ink2 },
  body: { fontSize: 15, lineHeight: 23, color: colors.ink2 },
  footer: {
    paddingHorizontal: layout.padX,
    paddingTop: 10,
    gap: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.hair,
  },
  markReadBtn: {
    alignSelf: "flex-start",
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: radius.sm,
    backgroundColor: colors.paper2,
  },
  markReadText: { fontSize: 13, fontWeight: "500", color: colors.ink2 },
});
