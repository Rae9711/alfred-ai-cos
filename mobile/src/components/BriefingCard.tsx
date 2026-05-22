// Daily briefing card at the top of Today (PRD 12.7). The morning hero moment: a
// dated greeting, the summary given room to breathe, and a quiet usefulness ask that
// collapses to a thank-you once answered. No accent-outlined box, no uppercase micro
// label (both generic-AI tics); hierarchy comes from type weight and a left accent rule.

import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import type { Briefing } from "@albert/shared-types";

import { api } from "@/api/client";
import { colors, spacing } from "@/theme/theme";

function greeting(): string {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}

function weekday(iso: string | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

export function BriefingCard() {
  const [briefing, setBriefing] = useState<Briefing | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
    setError(null);
    try {
      setBriefing(await api.generateBriefing());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't write your briefing");
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

  // --- Empty / generating state ---
  if (!briefing) {
    return (
      <View style={styles.card}>
        <View style={styles.rule} />
        <View style={styles.cardInner}>
          <Text style={styles.greeting}>{greeting()}</Text>
          <Text style={styles.emptyLead}>
            {busy ? "Reading your inbox and calendar…" : "Ready when you are."}
          </Text>
          {busy ? (
            <ActivityIndicator color={colors.accent} style={styles.spinner} />
          ) : (
            <Pressable style={styles.cta} onPress={generate}>
              <Text style={styles.ctaText}>Write today's briefing</Text>
            </Pressable>
          )}
          {error ? <Text style={styles.error}>{error}</Text> : null}
        </View>
      </View>
    );
  }

  // --- Briefing present ---
  const answered = briefing.user_feedback != null;
  return (
    <View style={styles.card}>
      <View style={styles.rule} />
      <View style={styles.cardInner}>
        <Text style={styles.greeting}>
          {greeting()}
          {weekday(briefing.date) ? ` · ${weekday(briefing.date)}` : ""}
        </Text>
        <Text style={styles.summary}>{briefing.summary}</Text>

        <View style={styles.feedbackRow}>
          {answered ? (
            <Text style={styles.feedbackThanks}>
              {briefing.user_feedback === "useful"
                ? "Glad it helped."
                : "Noted, I'll tune it."}
            </Text>
          ) : (
            <>
              <Text style={styles.feedbackAsk}>Was this useful?</Text>
              <Pressable hitSlop={8} onPress={() => void sendFeedback(true)}>
                <Text style={styles.feedbackYes}>Yes</Text>
              </Pressable>
              <Pressable hitSlop={8} onPress={() => void sendFeedback(false)}>
                <Text style={styles.feedbackNo}>No</Text>
              </Pressable>
            </>
          )}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: "row",
    backgroundColor: colors.surface,
    borderRadius: 16,
    overflow: "hidden",
  },
  // A single 3px accent rule down the left edge gives identity without framing the
  // whole card in accent (the generic-AI outlined-box look).
  rule: { width: 3, backgroundColor: colors.accent },
  cardInner: { flex: 1, padding: spacing.lg, gap: spacing.sm },

  greeting: { color: colors.textMuted, fontSize: 13, fontWeight: "500" },
  // The hero: large, near-white, generous line height. This is the one thing the eye
  // should land on first thing in the morning.
  summary: {
    color: colors.text,
    fontSize: 17,
    lineHeight: 25,
    fontWeight: "400",
  },

  feedbackRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    marginTop: spacing.sm,
  },
  feedbackAsk: { color: colors.textMuted, fontSize: 13, marginRight: "auto" },
  feedbackYes: { color: colors.accent, fontSize: 13, fontWeight: "600" },
  feedbackNo: { color: colors.textMuted, fontSize: 13, fontWeight: "600" },
  feedbackThanks: {
    color: colors.textMuted,
    fontSize: 13,
    fontStyle: "italic",
  },

  // Empty / generating
  emptyLead: { color: colors.text, fontSize: 17, lineHeight: 25 },
  spinner: { alignSelf: "flex-start", marginTop: spacing.xs },
  cta: {
    alignSelf: "flex-start",
    marginTop: spacing.xs,
    backgroundColor: colors.accent,
    borderRadius: 10,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  ctaText: { color: "#0E0F12", fontSize: 14, fontWeight: "700" },
  error: { color: "#E5484D", fontSize: 13, marginTop: spacing.xs },
});
