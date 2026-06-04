// Snooze sheet: park a Today priority with a wake condition. Sends the chosen
// phrase to /commitments/{id}/snooze; the server parses it and returns the
// interpretation so we can show the user what we recorded.

import { useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";

import { api } from "@/api/client";
import { Ic } from "@/components/icons";
import { useShell } from "@/components/Shell";
import { Btn, Eyebrow, H2, IconBtn } from "@/components/ui";
import { colors, fonts, spacing } from "@/theme/theme";

type Choice = { phrase: string; label: string; sub: string };

const CHOICES: Choice[] = [
  { phrase: "tomorrow", label: "Tomorrow", sub: "wakes at morning" },
  { phrase: "this weekend", label: "This weekend", sub: "Saturday" },
  { phrase: "next week", label: "Next week", sub: "Monday morning" },
  { phrase: "+3d", label: "In 3 days", sub: "+3d" },
  { phrase: "+7d", label: "In a week", sub: "+7d" },
  {
    phrase: "until reply",
    label: "Until they reply",
    sub: "I'll watch the thread",
  },
];

export function SnoozeSheet({
  commitmentId,
  onDone,
}: {
  commitmentId: string;
  onDone?: (interpretation: string) => void;
}) {
  const { closeSheet, showToast } = useShell();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const pick = async (choice: Choice) => {
    setBusy(choice.phrase);
    setError(null);
    try {
      const result = await api.snoozeCommitment(commitmentId, {
        phrase: choice.phrase,
      });
      closeSheet();
      showToast(`Snoozed: ${result.interpreted_as}`);
      onDone?.(result.interpreted_as);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't snooze");
    } finally {
      setBusy(null);
    }
  };

  return (
    <View style={styles.wrap}>
      <View style={styles.head}>
        <View style={styles.headText}>
          <Eyebrow>Snooze</Eyebrow>
          <H2 style={styles.title}>When should I bring this back?</H2>
        </View>
        <IconBtn onPress={closeSheet}>
          <Ic.Close size={16} />
        </IconBtn>
      </View>

      <View style={styles.choices}>
        {CHOICES.map((c) => (
          <Btn
            key={c.phrase}
            label={c.label}
            kind="ghost"
            onPress={() => void pick(c)}
            style={styles.choiceBtn}
          />
        ))}
      </View>

      {busy ? (
        <View style={styles.busy}>
          <ActivityIndicator color={colors.accent} />
          <Text style={styles.busyLabel}>Snoozing…</Text>
        </View>
      ) : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flexShrink: 1, minHeight: 0, gap: spacing.md },
  head: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
  },
  headText: { flex: 1, gap: 4 },
  title: { marginTop: 6 },
  choices: { gap: spacing.sm, marginTop: spacing.sm },
  choiceBtn: { width: "100%", justifyContent: "flex-start" },
  busy: { flexDirection: "row", gap: 10, alignItems: "center" },
  busyLabel: { fontFamily: fonts.mono, fontSize: 12, color: colors.ink3 },
  error: { color: colors.warn, fontSize: 13 },
});
