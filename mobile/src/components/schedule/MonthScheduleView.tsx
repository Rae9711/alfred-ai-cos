import { useMemo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { UpcomingMeeting } from "@albert/shared-types";

import {
  buildMonthGrid,
  dateKey,
  isSameDay,
  localDateKeyFromDate,
  meetingsForDay,
} from "@/lib/schedule";
import { colors, fonts, radius, spacing } from "@/theme/theme";

function formatTime(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
}

export function MonthScheduleView({
  meetings,
  selectedDay,
  onSelectDay,
  onEventPress,
}: {
  meetings: UpcomingMeeting[];
  selectedDay: Date | null;
  onSelectDay: (day: Date | null) => void;
  onEventPress: (event: UpcomingMeeting) => void;
}) {
  const now = new Date();
  const monthGrid = useMemo(
    () => buildMonthGrid(now.getFullYear(), now.getMonth()),
    [],
  );
  const eventCountByDay = useMemo(() => {
    const counts = new Map<string, number>();
    for (const m of meetings) {
      const key = dateKey(m.start_time);
      if (!key) continue;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return counts;
  }, [meetings]);

  const agendaDay = selectedDay ?? now;
  const agendaMeetings = useMemo(
    () => meetingsForDay(meetings, agendaDay),
    [meetings, agendaDay],
  );

  return (
    <>
      <View style={styles.monthGrid}>
        {["M", "T", "W", "T", "F", "S", "S"].map((d, i) => (
          <Text key={`${d}-${i}`} style={styles.monthWeekday}>
            {d}
          </Text>
        ))}
        {monthGrid.flat().map((day, i) => {
          if (!day) {
            return <View key={`pad-${i}`} style={styles.monthCell} />;
          }
          const key = localDateKeyFromDate(day);
          const count = eventCountByDay.get(key) ?? 0;
          const selected = selectedDay !== null && isSameDay(day, selectedDay);
          const today = isSameDay(day, now);
          return (
            <Pressable
              key={key}
              style={[
                styles.monthCell,
                today && styles.monthCellToday,
                selected && styles.monthCellSelected,
              ]}
              onPress={() =>
                onSelectDay(
                  selectedDay && isSameDay(selectedDay, day) ? null : day,
                )
              }
            >
              <Text
                style={[
                  styles.monthDayNum,
                  today && styles.monthDayNumToday,
                  selected && styles.monthDayNumSelected,
                ]}
              >
                {day.getDate()}
              </Text>
              {count > 0 ? (
                <View style={styles.dotRow}>
                  {count <= 3 ? (
                    Array.from({ length: count }, (_, j) => (
                      <View key={j} style={styles.monthDot} />
                    ))
                  ) : (
                    <Text style={styles.countBadge}>{count}</Text>
                  )}
                </View>
              ) : null}
            </Pressable>
          );
        })}
      </View>

      <View style={styles.agenda}>
        <Text style={styles.agendaLabel}>
          {agendaDay.toLocaleDateString(undefined, {
            weekday: "long",
            month: "short",
            day: "numeric",
          })}
        </Text>
        {agendaMeetings.length > 0 ? (
          agendaMeetings.map((item) => {
            const past =
              item.start_time != null &&
              new Date(item.start_time).getTime() < Date.now();
            return (
              <Pressable
                key={item.id}
                onPress={() => onEventPress(item)}
                style={({ pressed }) => [
                  styles.agendaRow,
                  past && styles.agendaPast,
                  pressed && styles.rowPressed,
                ]}
              >
                <Text style={styles.agendaTime}>
                  {formatTime(item.start_time)}
                </Text>
                <View style={styles.agendaBody}>
                  <Text style={styles.agendaTitle}>
                    {item.title ?? "Meeting"}
                  </Text>
                  {item.location?.trim() ? (
                    <Text style={styles.agendaDetail}>{item.location.trim()}</Text>
                  ) : null}
                </View>
              </Pressable>
            );
          })
        ) : (
          <Text style={styles.agendaEmpty}>No events this day.</Text>
        )}
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  monthGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    marginBottom: spacing.sm,
  },
  monthWeekday: {
    width: `${100 / 7}%`,
    textAlign: "center",
    fontFamily: fonts.mono,
    fontSize: 10,
    color: colors.ink4,
    paddingBottom: 6,
  },
  monthCell: {
    width: `${100 / 7}%`,
    aspectRatio: 1,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.sm,
  },
  monthCellToday: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.hair2,
  },
  monthCellSelected: {
    backgroundColor: colors.accentSoft,
  },
  monthDayNum: {
    fontSize: 14,
    color: colors.ink2,
    fontWeight: "500",
  },
  monthDayNumToday: {
    color: colors.accent,
    fontWeight: "700",
  },
  monthDayNumSelected: {
    color: colors.accent,
  },
  dotRow: {
    flexDirection: "row",
    gap: 2,
    marginTop: 2,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 8,
  },
  monthDot: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
    backgroundColor: colors.accent,
  },
  countBadge: {
    fontFamily: fonts.mono,
    fontSize: 9,
    color: colors.accent,
    fontWeight: "600",
  },
  agenda: { gap: 0, marginTop: spacing.sm },
  agendaLabel: {
    fontFamily: fonts.mono,
    fontSize: 10,
    letterSpacing: 1.2,
    textTransform: "uppercase",
    color: colors.ink4,
    marginBottom: 6,
  },
  agendaRow: {
    flexDirection: "row",
    gap: 14,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.hair,
  },
  agendaPast: { opacity: 0.55 },
  rowPressed: { opacity: 0.85 },
  agendaTime: {
    width: 48,
    fontFamily: fonts.mono,
    fontSize: 12,
    color: colors.ink3,
    paddingTop: 2,
  },
  agendaBody: { flex: 1, gap: 2 },
  agendaTitle: {
    fontSize: 16,
    fontWeight: "600",
    color: colors.ink,
  },
  agendaDetail: { fontSize: 14, color: colors.ink3 },
  agendaEmpty: {
    fontSize: 14,
    color: colors.ink3,
    fontStyle: "italic",
  },
});
