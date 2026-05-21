// Meeting prep brief (PRD 10.5). Loads context, open commitments, and suggested
// questions for one upcoming event.

import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import type { MeetingPrep } from "@albert/shared-types";

import { api } from "@/api/client";
import { colors, spacing } from "@/theme/theme";

export function MeetingPrepScreen({ eventId }: { eventId: string }) {
  const [prep, setPrep] = useState<MeetingPrep | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setError(null);
      setPrep(await api.getMeetingPrep(eventId));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load prep");
    }
  }, [eventId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (error) {
    return (
      <View style={styles.centered}>
        <Text style={styles.error}>{error}</Text>
      </View>
    );
  }
  if (!prep) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Text style={styles.title}>{prep.event.title ?? "Meeting"}</Text>
      {prep.event.start_time ? (
        <Text style={styles.meta}>
          {new Date(prep.event.start_time).toLocaleString()}
        </Text>
      ) : null}
      <Text style={styles.meta}>
        {prep.related_message_count} related message(s) ·{" "}
        {prep.event.attendees.length} attendee(s)
      </Text>

      <Text style={styles.section}>Context</Text>
      <Text style={styles.body}>{prep.summary}</Text>

      {prep.open_commitments.length ? (
        <>
          <Text style={styles.section}>Open commitments</Text>
          {prep.open_commitments.map((c, i) => (
            <Text key={i} style={styles.item}>
              • {c}
            </Text>
          ))}
        </>
      ) : null}

      {prep.suggested_questions.length ? (
        <>
          <Text style={styles.section}>Suggested questions</Text>
          {prep.suggested_questions.map((q, i) => (
            <Text key={i} style={styles.item}>
              • {q}
            </Text>
          ))}
        </>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.lg, gap: spacing.sm },
  centered: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.bg,
  },
  title: { color: colors.text, fontSize: 24, fontWeight: "700" },
  meta: { color: colors.textMuted, fontSize: 13 },
  section: {
    color: colors.text,
    fontSize: 16,
    fontWeight: "600",
    marginTop: spacing.md,
  },
  body: { color: colors.textMuted, fontSize: 14, lineHeight: 20 },
  item: { color: colors.textMuted, fontSize: 14, lineHeight: 20 },
  error: { color: "#E5484D", fontSize: 14, padding: spacing.lg },
});
