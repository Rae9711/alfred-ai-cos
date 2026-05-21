// Waiting-for tracker (PRD 10.1, journey 5). Two sections: people waiting on you,
// and who you are waiting on, oldest first so stale items surface.

import { useCallback, useEffect, useState } from "react";
import {
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import {
  SourceType,
  type WaitingEntry,
  type WaitingView,
} from "@albert/shared-types";

import { api } from "@/api/client";
import { colors, spacing } from "@/theme/theme";

function Entry({
  entry,
  onFollowUp,
}: {
  entry: WaitingEntry;
  onFollowUp: () => void;
}) {
  return (
    <View style={styles.entry}>
      <Text style={styles.desc}>{entry.description}</Text>
      <Text style={styles.meta}>
        {entry.counterparty ?? "Someone"} · {entry.age_days}d old
        {entry.due_date ? ` · due ${entry.due_date}` : ""}
      </Text>
      {entry.source_type === SourceType.Gmail && entry.source_id ? (
        <Pressable onPress={onFollowUp}>
          <Text style={styles.action}>Draft a follow-up</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

export function WaitingScreen() {
  const [view, setView] = useState<WaitingView | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const load = useCallback(async () => {
    setView(await api.getWaiting());
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await load();
    } finally {
      setRefreshing(false);
    }
  }, [load]);

  const followUp = useCallback(async (sourceId: string) => {
    setNote(null);
    try {
      await api.createDraft({ message_id: sourceId, tone: "warm" });
      setNote("Drafted a follow-up. Review it in the message thread.");
    } catch (e) {
      setNote(e instanceof Error ? e.message : "Could not draft follow-up");
    }
  }, []);

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={refresh}
          tintColor={colors.accent}
        />
      }
    >
      <Text style={styles.heading}>Waiting</Text>
      {note ? <Text style={styles.note}>{note}</Text> : null}

      <Text style={styles.section}>People waiting on you</Text>
      {view?.waiting_on_you.length ? (
        view.waiting_on_you.map((e) => (
          <Entry
            key={e.id}
            entry={e}
            onFollowUp={() => void followUp(e.source_id!)}
          />
        ))
      ) : (
        <Text style={styles.empty}>Nobody is blocked on you. Clean slate.</Text>
      )}

      <Text style={styles.section}>You are waiting on</Text>
      {view?.you_are_waiting_on.length ? (
        view.you_are_waiting_on.map((e) => (
          <Entry
            key={e.id}
            entry={e}
            onFollowUp={() => void followUp(e.source_id!)}
          />
        ))
      ) : (
        <Text style={styles.empty}>Not waiting on anyone right now.</Text>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.lg, gap: spacing.sm },
  heading: { color: colors.text, fontSize: 28, fontWeight: "700" },
  note: { color: colors.accent, fontSize: 13 },
  section: {
    color: colors.text,
    fontSize: 18,
    fontWeight: "600",
    marginTop: spacing.md,
  },
  empty: { color: colors.textMuted, fontSize: 13, fontStyle: "italic" },
  entry: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    padding: spacing.md,
    gap: 2,
  },
  desc: { color: colors.text, fontSize: 15 },
  meta: { color: colors.textMuted, fontSize: 12 },
  action: { color: colors.accent, fontSize: 13, marginTop: spacing.xs },
});
