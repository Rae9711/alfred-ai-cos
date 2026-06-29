// Planning suggestions — time-block fit + quick wins from GET /today.

import { Pressable, StyleSheet, Text, View } from "react-native";
import {
  TaskStatus,
  type QuickWin,
  type TimeBlockSuggestion,
  type TodayDashboard,
} from "@albert/shared-types";

import { api } from "@/api/client";
import { useShell } from "@/components/Shell";
import { Meta, Serif } from "@/components/ui";
import { useLocale } from "@/context/LocaleContext";
import { ApprovalSheet } from "@/screens/sheets/ApprovalSheet";
import { colors, radius, spacing } from "@/theme/theme";

type Props = {
  data: TodayDashboard | null;
  onChanged?: () => void;
};

function formatGapTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
}

export function PlanningSuggestionsCard({ data, onChanged }: Props) {
  const { t } = useLocale();
  const { openSheet, showToast } = useShell();

  if (!data) return null;
  const { suggestions, quick_wins: quickWins } = data;
  if (!suggestions.length && !quickWins.length) return null;

  const openItem = (item: TimeBlockSuggestion | QuickWin) => {
    const id = "item_id" in item ? item.item_id : item.id;
    if (item.item_type === "commitment") {
      openSheet(
        <ApprovalSheet
          commitmentId={id}
          recipient="them"
          onDone={() => onChanged?.()}
        />,
      );
      return;
    }
    void api
      .updateTaskStatus(id, TaskStatus.Done)
      .then(() => {
        showToast(t.planning.markedDone);
        onChanged?.();
      })
      .catch(() => showToast(t.planning.updateFailed));
  };

  return (
    <View style={styles.root}>
      <Text style={styles.label}>{t.planning.sectionLabel}</Text>

      {suggestions.map((s) => (
        <Pressable
          key={`${s.item_id}-${s.gap_start}`}
          style={({ pressed }) => [styles.blockCard, pressed && styles.pressed]}
          onPress={() => openItem(s)}
        >
          <Serif size={16} style={styles.blockTitle}>
            {s.title}
          </Serif>
          <Text style={styles.blockReason}>
            {t.planning.timeBlock(
              s.duration_minutes,
              formatGapTime(s.gap_start),
              formatGapTime(s.gap_end),
              s.estimated_minutes,
            )}
          </Text>
        </Pressable>
      ))}

      {quickWins.length ? (
        <View style={styles.quickSection}>
          <Meta>{t.planning.quickWinsLabel(quickWins.length)}</Meta>
          {quickWins.map((q) => (
            <Pressable
              key={q.id}
              style={({ pressed }) => [styles.quickRow, pressed && styles.pressed]}
              onPress={() => openItem(q)}
            >
              <Text style={styles.quickText}>{q.title}</Text>
              <Meta>{t.planning.minutes(q.estimated_minutes)}</Meta>
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { marginTop: spacing.lg, gap: 10 },
  label: {
    fontSize: 10,
    letterSpacing: 1.4,
    textTransform: "uppercase",
    color: colors.ink4,
  },
  blockCard: {
    backgroundColor: colors.card,
    borderRadius: radius.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.hair2,
    padding: spacing.md,
    gap: 6,
  },
  blockTitle: { color: colors.ink },
  blockReason: { fontSize: 13, lineHeight: 19, color: colors.ink3 },
  quickSection: { gap: 6 },
  quickRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
    backgroundColor: colors.paper2,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.hair,
  },
  quickText: { flex: 1, color: colors.ink, fontSize: 14 },
  pressed: { opacity: 0.85 },
});
