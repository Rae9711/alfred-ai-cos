// Daily briefing card at the top of Today (PRD 12.7). Loads today's briefing,
// offers to generate one if none exists, and collects useful/not-useful feedback.

import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import type { Briefing } from "@albert/shared-types";

import { api } from "@/api/client";
import { colors, spacing } from "@/theme/theme";

export function BriefingCard() {
  const [briefing, setBriefing] = useState<Briefing | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setBriefing(await api.getTodayBriefing());
    } catch {
      setBriefing(null); // 404 = none yet today
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const generate = useCallback(async () => {
    setBusy(true);
    try {
      setBriefing(await api.generateBriefing());
    } finally {
      setBusy(false);
    }
  }, []);

  const sendFeedback = useCallback(
    async (useful: boolean) => {
      if (!briefing) return;
      setBriefing(await api.briefingFeedback(briefing.id, useful));
    },
    [briefing],
  );

  if (!briefing) {
    return (
      <Pressable style={styles.generate} onPress={generate} disabled={busy}>
        <Text style={styles.generateText}>
          {busy ? "Writing your briefing…" : "Generate today's briefing"}
        </Text>
        {busy ? <ActivityIndicator color={colors.text} /> : null}
      </Pressable>
    );
  }

  return (
    <View style={styles.card}>
      <Text style={styles.label}>Morning briefing</Text>
      <Text style={styles.body}>{briefing.summary}</Text>
      <View style={styles.feedbackRow}>
        <Pressable onPress={() => void sendFeedback(true)}>
          <Text style={[styles.feedback, briefing.user_feedback === "useful" && styles.active]}>
            Useful
          </Text>
        </Pressable>
        <Pressable onPress={() => void sendFeedback(false)}>
          <Text
            style={[styles.feedback, briefing.user_feedback === "not_useful" && styles.active]}
          >
            Not useful
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.accent,
    padding: spacing.md,
    gap: spacing.sm,
  },
  label: { color: colors.accent, fontSize: 12, fontWeight: "700", textTransform: "uppercase" },
  body: { color: colors.text, fontSize: 14, lineHeight: 21 },
  feedbackRow: { flexDirection: "row", gap: spacing.lg, marginTop: spacing.xs },
  feedback: { color: colors.textMuted, fontSize: 12 },
  active: { color: colors.accent, fontWeight: "700" },
  generate: {
    backgroundColor: colors.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  generateText: { color: colors.text, fontSize: 14, fontWeight: "600" },
});
