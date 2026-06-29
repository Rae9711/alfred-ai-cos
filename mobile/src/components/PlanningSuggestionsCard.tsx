// Planning suggestions — time-block fit + quick wins from GET /today.

import { useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import {
  TaskStatus,
  type QuickWin,
  type TimeBlockSuggestion,
  type TodayDashboard,
} from "@albert/shared-types";

import { api } from "@/api/client";
import { useShell } from "@/components/Shell";
import { Btn, Meta, Serif } from "@/components/ui";
import { useLocale } from "@/context/LocaleContext";
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

function formatSlotRange(start: Date, end: Date): string {
  return `${formatGapTime(start.toISOString())}–${formatGapTime(end.toISOString())}`;
}

type BlockState = {
  start: Date;
  end: Date;
  scheduling: boolean;
};

function TimeBlockRow({
  suggestion,
  onChanged,
}: {
  suggestion: TimeBlockSuggestion;
  onChanged?: () => void;
}) {
  const { t } = useLocale();
  const { showToast } = useShell();
  const initial = useMemo(
    () => ({
      start: new Date(suggestion.gap_start),
      end: new Date(suggestion.gap_end),
    }),
    [suggestion.gap_start, suggestion.gap_end],
  );
  const [slot, setSlot] = useState<BlockState>({
    start: initial.start,
    end: initial.end,
    scheduling: false,
  });

  const shiftMinutes = (delta: number) => {
    setSlot((s) => {
      const start = new Date(s.start.getTime() + delta * 60_000);
      const durationMs = s.end.getTime() - s.start.getTime();
      const end = new Date(start.getTime() + durationMs);
      return { ...s, start, end };
    });
  };

  const addToCalendar = () => {
    setSlot((s) => ({ ...s, scheduling: true }));
    void api
      .schedulePlanningBlock({
        title: suggestion.title,
        start: slot.start.toISOString(),
        end: slot.end.toISOString(),
      })
      .then(() => {
        showToast(t.planning.scheduled);
        onChanged?.();
      })
      .catch(() => showToast(t.planning.scheduleFailed))
      .finally(() => setSlot((s) => ({ ...s, scheduling: false })));
  };

  return (
    <View style={styles.blockCard}>
      <Serif size={16} style={styles.blockTitle}>
        {suggestion.title}
      </Serif>
      <Text style={styles.blockReason}>
        {t.planning.timeBlock(
          suggestion.duration_minutes,
          formatGapTime(suggestion.gap_start),
          formatGapTime(suggestion.gap_end),
          suggestion.estimated_minutes,
        )}
      </Text>
      <View style={styles.slotRow}>
        <Text style={styles.slotLabel}>{t.planning.adjustTime}</Text>
        <View style={styles.slotControls}>
          <Pressable style={styles.slotBtn} onPress={() => shiftMinutes(-15)}>
            <Text style={styles.slotBtnText}>{t.planning.earlier}</Text>
          </Pressable>
          <Text style={styles.slotTime}>{formatSlotRange(slot.start, slot.end)}</Text>
          <Pressable style={styles.slotBtn} onPress={() => shiftMinutes(15)}>
            <Text style={styles.slotBtnText}>{t.planning.laterSlot}</Text>
          </Pressable>
        </View>
      </View>
      <Btn
        label={t.planning.addToCalendar}
        onPress={addToCalendar}
        disabled={slot.scheduling}
        style={styles.scheduleBtn}
      />
    </View>
  );
}

export function PlanningSuggestionsCard({ data, onChanged }: Props) {
  const { t } = useLocale();
  const { showToast } = useShell();

  if (!data) return null;
  const { suggestions, quick_wins: quickWins } = data;
  if (!suggestions.length && !quickWins.length) return null;

  const markQuickWinDone = (item: QuickWin) => {
    if (item.item_type !== "task") return;
    void api
      .updateTaskStatus(item.id, TaskStatus.Done)
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
        <TimeBlockRow
          key={`${s.item_id}-${s.gap_start}`}
          suggestion={s}
          onChanged={onChanged}
        />
      ))}

      {quickWins.length ? (
        <View style={styles.quickSection}>
          <Meta>{t.planning.quickWinsLabel(quickWins.length)}</Meta>
          {quickWins.map((q) => (
            <Pressable
              key={q.id}
              style={({ pressed }) => [styles.quickRow, pressed && styles.pressed]}
              onPress={() => markQuickWinDone(q)}
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
    gap: 10,
  },
  blockTitle: { color: colors.ink },
  blockReason: { fontSize: 13, lineHeight: 19, color: colors.ink3 },
  slotRow: { gap: 6 },
  slotLabel: {
    fontSize: 10,
    letterSpacing: 1.2,
    textTransform: "uppercase",
    color: colors.ink4,
  },
  slotControls: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    flexWrap: "wrap",
  },
  slotBtn: {
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: radius.sm,
    backgroundColor: colors.paper2,
  },
  slotBtnText: { fontSize: 12, fontWeight: "500", color: colors.ink2 },
  slotTime: {
    flex: 1,
    minWidth: 120,
    fontSize: 15,
    fontWeight: "600",
    color: colors.ink,
    textAlign: "center",
  },
  scheduleBtn: { alignSelf: "stretch" },
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
