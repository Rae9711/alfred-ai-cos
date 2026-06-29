// Deep link target for prep-draft push notifications (/draft/{id}).

import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";

import { api } from "@/api/client";
import { Ic } from "@/components/icons";
import { useShell } from "@/components/Shell";
import { Btn, Eyebrow, H2, Serif, SerifEm } from "@/components/ui";
import { colors, fonts, layout, spacing } from "@/theme/theme";

export default function DraftReviewRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { showToast } = useShell();
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<{
    id: string;
    subject: string | null;
    body: string;
    tone: string;
  } | null>(null);

  useEffect(() => {
    if (!id) return;
    void (async () => {
      try {
        const d = await api.getDraft(id);
        setDraft(d);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Draft not found");
      } finally {
        setLoading(false);
      }
    })();
  }, [id]);

  const send = () => {
    if (!draft || sending) return;
    setSending(true);
    void (async () => {
      try {
        const proposal = await api.proposeSendDraft(draft.id);
        await api.approveAction(proposal.id);
        showToast("Sent.");
        router.back();
      } catch (e) {
        showToast(e instanceof Error ? e.message : "Couldn't send");
      } finally {
        setSending(false);
      }
    })();
  };

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }

  if (error || !draft) {
    return (
      <View style={styles.centered}>
        <Text style={styles.error}>{error ?? "Draft not found"}</Text>
        <Btn label="Go back" onPress={() => router.back()} />
      </View>
    );
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Pressable onPress={() => router.back()} style={styles.back}>
        <View style={styles.backIcon}>
          <Ic.Arrow size={18} color={colors.ink2} />
        </View>
        <Text style={styles.backText}>Back</Text>
      </Pressable>

      <Eyebrow color={colors.accent}>Review your draft</Eyebrow>
      <H2 style={styles.title}>
        Reply <SerifEm>ready</SerifEm>
      </H2>

      {draft.subject ? (
        <Text style={styles.subject}>{draft.subject}</Text>
      ) : null}
      <Serif size={16} style={styles.body}>
        {draft.body}
      </Serif>

      <View style={styles.actions}>
        <Btn
          label={sending ? "Sending…" : "Send from Gmail"}
          onPress={send}
          disabled={sending}
        />
        <Btn label="Not now" kind="ghost" onPress={() => router.back()} />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.paper },
  content: {
    paddingHorizontal: layout.padX,
    paddingTop: layout.topPad,
    paddingBottom: spacing.xl,
    gap: spacing.md,
  },
  centered: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.paper,
    padding: layout.padX,
    gap: spacing.md,
  },
  back: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 8 },
  backIcon: { transform: [{ rotate: "180deg" }] },
  backText: { fontSize: 14, color: colors.ink3 },
  title: { marginTop: 4 },
  subject: { fontSize: 14, color: colors.ink3, fontWeight: "600" },
  body: { color: colors.ink2, lineHeight: 24 },
  actions: { gap: 10, marginTop: spacing.lg },
  error: { color: colors.warn, textAlign: "center", marginBottom: spacing.md },
});
