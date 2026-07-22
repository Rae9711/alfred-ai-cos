// Planning focus card — AlfredHome “安排一个时间块” glass card from GET /today.

import { useMemo, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import {
  TaskStatus,
  type QuickWin,
  type TimeBlockSuggestion,
  type TodayDashboard,
} from "@albert/shared-types";

import { api } from "@/api/client";
import { AlfredIcon } from "@/components/AlfredIcon";
import { Ic } from "@/components/icons";
import { useShell } from "@/components/Shell";
import { Meta } from "@/components/ui";
import { useLocale } from "@/context/LocaleContext";
import { colors, fonts, radius, spacing } from "@/theme/theme";
import { surfaces } from "@/theme/surfaces";

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

function formatDuration(minutes: number, locale: string): string {
  if (minutes < 60) {
    return locale === "zh" ? `${minutes} 分钟` : `${minutes} min`;
  }
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (locale === "zh") {
    return m ? `${h} 小时 ${m} 分钟` : `${h} 小时`;
  }
  return m ? `${h}h ${m}m` : `${h}h`;
}

type BlockState = {
  start: Date;
  end: Date;
  scheduling: boolean;
  done: boolean;
};

function FocusTimeBlock({
  suggestion,
  onChanged,
}: {
  suggestion: TimeBlockSuggestion;
  onChanged?: () => void;
}) {
  const { t, locale } = useLocale();
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
    done: false,
  });

  const durationMin = Math.max(
    1,
    Math.round((slot.end.getTime() - slot.start.getTime()) / 60_000),
  );

  const shiftDuration = (delta: number) => {
    setSlot((s) => {
      const nextEnd = new Date(s.end.getTime() + delta * 60_000);
      const nextDuration = Math.round(
        (nextEnd.getTime() - s.start.getTime()) / 60_000,
      );
      if (nextDuration < 15) {
        return {
          ...s,
          end: new Date(s.start.getTime() + 15 * 60_000),
        };
      }
      // Don't extend past the original gap end.
      const gapEnd = initial.end.getTime();
      if (nextEnd.getTime() > gapEnd) {
        return { ...s, end: new Date(gapEnd) };
      }
      return { ...s, end: nextEnd };
    });
  };

  const addToCalendar = () => {
    if (slot.done) return;
    setSlot((s) => ({ ...s, scheduling: true }));
    void api
      .schedulePlanningBlock({
        title: suggestion.title,
        start: slot.start.toISOString(),
        end: slot.end.toISOString(),
      })
      .then(() => {
        showToast(t.planning.scheduled);
        setSlot((s) => ({ ...s, done: true, scheduling: false }));
        onChanged?.();
      })
      .catch(() => {
        showToast(t.planning.scheduleFailed);
        setSlot((s) => ({ ...s, scheduling: false }));
      });
  };

  return (
    <View style={styles.focusCard}>
      <View style={styles.focusTop}>
        <AlfredIcon icon={Ic.Stack} variant="assistant" size="medium" />
        <View style={styles.focusTitle}>
          <Text style={styles.focusKicker}>{t.planning.importantTask}</Text>
          <Text style={styles.focusHeading} numberOfLines={3}>
            {suggestion.title}
          </Text>
          {suggestion.reason ? (
            <Text style={styles.focusReason} numberOfLines={3}>
              {suggestion.reason}
            </Text>
          ) : null}
        </View>
      </View>

      <View style={styles.focusDivider} />

      <View style={styles.timeRow}>
        <View style={styles.timeDesc}>
          <Ic.Clock size={16} color={colors.ink3} stroke={1.8} />
          <Text style={styles.timeDescText}>
            {t.planning.minutesAvailable(suggestion.duration_minutes)}
          </Text>
        </View>
        <Text style={styles.timeRange}>
          {formatGapTime(slot.start.toISOString())} —{" "}
          {formatGapTime(slot.end.toISOString())}
        </Text>
      </View>

      <View style={styles.timeControls}>
        <Pressable style={styles.slotBtn} onPress={() => shiftDuration(-15)}>
          <Text style={styles.slotBtnText}>{t.planning.earlier}</Text>
        </Pressable>
        <Text style={styles.slotDuration}>
          {formatDuration(durationMin, locale)}
        </Text>
        <Pressable style={styles.slotBtn} onPress={() => shiftDuration(15)}>
          <Text style={styles.slotBtnText}>{t.planning.laterSlot}</Text>
        </Pressable>
      </View>

      <Pressable
        style={[styles.primaryBtn, slot.done && styles.primaryBtnDone]}
        onPress={addToCalendar}
        disabled={slot.scheduling || slot.done}
      >
        {slot.scheduling ? (
          <ActivityIndicator color="#FFFFFF" />
        ) : slot.done ? (
          <>
            <Ic.Check size={18} color="#FFFFFF" stroke={2.2} />
            <Text style={styles.primaryBtnText}>{t.planning.addedToCalendar}</Text>
          </>
        ) : (
          <>
            <Ic.Calendar size={18} color="#FFFFFF" stroke={1.8} />
            <Text style={styles.primaryBtnText}>{t.planning.addToCalendar}</Text>
          </>
        )}
      </Pressable>
    </View>
  );
}

export function PlanningSuggestionsCard({ data, onChanged }: Props) {
  const { t } = useLocale();
  const { showToast } = useShell();

  if (!data) return null;
  const { suggestions, quick_wins: quickWins } = data;
  if (!suggestions.length && !quickWins.length) return null;

  const top = suggestions[0] ?? null;
  const restWins = quickWins;

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
      {top ? (
        <>
          <View style={styles.sectionHeader}>
            <View>
              <Text style={styles.sectionLabel}>{t.planning.alfredSuggests}</Text>
              <Text style={styles.sectionTitle}>{t.planning.scheduleBlock}</Text>
            </View>
            <View style={styles.aiBadge}>
              <Ic.Sparkles size={13} color="#5D55D8" stroke={2} />
              <Text style={styles.aiBadgeText}>{t.planning.aiRecommended}</Text>
            </View>
          </View>
          <FocusTimeBlock suggestion={top} onChanged={onChanged} />
        </>
      ) : null}

      {restWins.length ? (
        <View style={styles.quickSection}>
          <Meta>{t.planning.quickWinsLabel(restWins.length)}</Meta>
          {restWins.map((q) => (
            <Pressable
              key={q.id}
              style={({ pressed }) => [styles.quickRow, pressed && styles.pressed]}
              onPress={() => markQuickWinDone(q)}
            >
              <View style={styles.quickWell}>
                <Ic.StackFill size={12} color={colors.accent} />
              </View>
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
  root: { marginTop: spacing.lg, gap: 12 },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "space-between",
    marginHorizontal: 4,
    marginBottom: 4,
  },
  sectionLabel: {
    fontFamily: fonts.sans,
    fontSize: 11,
    color: "#7E7B75",
    marginBottom: 6,
  },
  sectionTitle: {
    fontFamily: fonts.serifDisplay,
    fontSize: 20,
    letterSpacing: -0.4,
    color: colors.ink,
  },
  aiBadge: {
    ...surfaces.aiPill,
  },
  aiBadgeText: {
    ...surfaces.aiPillText,
  },
  focusCard: {
    position: "relative",
    overflow: "hidden",
    padding: 14,
    ...surfaces.glassCard,
    borderRadius: 22,
    gap: 0,
  },
  focusTop: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
  },
  focusTitle: { flex: 1, minWidth: 0 },
  focusKicker: {
    fontFamily: fonts.sansSemibold,
    fontSize: 10,
    color: colors.blue700,
  },
  focusHeading: {
    marginTop: 4,
    fontFamily: fonts.sansSemibold,
    fontSize: 15,
    lineHeight: 20,
    color: colors.ink,
  },
  focusReason: {
    marginTop: 4,
    fontFamily: fonts.sans,
    fontSize: 11,
    lineHeight: 16,
    color: colors.ink3,
  },
  focusDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.line,
    marginTop: 13,
  },
  timeRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    flexWrap: "wrap",
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.line,
  },
  timeDesc: { flexDirection: "row", alignItems: "center", gap: 5 },
  timeDescText: {
    fontFamily: fonts.sans,
    fontSize: 10,
    color: "#66728A",
  },
  timeRange: {
    fontFamily: fonts.sans,
    fontSize: 10,
    color: "#66728A",
  },
  timeControls: {
    paddingVertical: 10,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  slotBtn: {
    paddingVertical: 7,
    paddingHorizontal: 12,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: "#E3DDD3",
    backgroundColor: "#FFFAF4",
  },
  slotBtnText: {
    fontFamily: fonts.sansMedium,
    fontSize: 10,
    color: "#40506B",
  },
  slotDuration: {
    fontFamily: fonts.sansSemibold,
    fontSize: 11,
    color: colors.ink,
  },
  primaryBtn: {
    marginTop: 4,
    minHeight: 44,
    borderRadius: 14,
    backgroundColor: colors.blue700,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  primaryBtnDone: {
    backgroundColor: colors.success,
  },
  primaryBtnText: {
    fontFamily: fonts.sansSemibold,
    fontSize: 14,
    color: "#FFFFFF",
  },
  quickSection: { gap: 8, marginTop: 4 },
  quickRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 12,
    paddingHorizontal: 14,
    ...surfaces.glassCard,
    borderRadius: 16,
  },
  quickWell: {
    width: 28,
    height: 28,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.accentSoft,
  },
  quickText: {
    flex: 1,
    fontFamily: fonts.sansMedium,
    color: colors.ink,
    fontSize: 14,
  },
  pressed: { opacity: 0.85 },
});
