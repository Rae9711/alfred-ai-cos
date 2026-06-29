import { useMemo } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import type { UpcomingMeeting } from "@albert/shared-types";

import {
  formatWeekdayShort,
  isSameDay,
  meetingsForDay,
  weekDaysMondayFirst,
} from "@/lib/schedule";
import { colors, fonts, radius, spacing } from "@/theme/theme";

function formatTime(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
}

export function WeekScheduleView({
  meetings,
  onEventPress,
  emptyText = "Nothing on the calendar this week.",
}: {
  meetings: UpcomingMeeting[];
  onEventPress: (event: UpcomingMeeting) => void;
  emptyText?: string;
}) {
  const days = useMemo(() => weekDaysMondayFirst(), []);
  const today = new Date();
  const hasAny = meetings.length > 0;

  if (!hasAny) {
    return <Text style={styles.empty}>{emptyText}</Text>;
  }

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.strip}
    >
      {days.map((day) => {
        const dayMeetings = meetingsForDay(meetings, day);
        const todayCol = isSameDay(day, today);
        return (
          <View
            key={day.toISOString()}
            style={[styles.col, todayCol && styles.colToday]}
          >
            <Text style={[styles.colWeekday, todayCol && styles.colTodayText]}>
              {formatWeekdayShort(day)}
            </Text>
            <Text style={[styles.colDate, todayCol && styles.colTodayNum]}>
              {day.getDate()}
            </Text>
            <View style={styles.events}>
              {dayMeetings.length === 0 ? (
                <Text style={styles.colEmpty}>—</Text>
              ) : (
                dayMeetings.map((event) => {
                  const past =
                    event.start_time != null &&
                    new Date(event.start_time).getTime() < Date.now();
                  return (
                    <Pressable
                      key={event.id}
                      onPress={() => onEventPress(event)}
                      style={({ pressed }) => [
                        styles.eventChip,
                        past && styles.eventPast,
                        pressed && styles.eventPressed,
                      ]}
                    >
                      <Text style={styles.chipTime} numberOfLines={1}>
                        {formatTime(event.start_time)}
                      </Text>
                      <Text style={styles.chipTitle} numberOfLines={2}>
                        {event.title ?? "Meeting"}
                      </Text>
                    </Pressable>
                  );
                })
              )}
            </View>
          </View>
        );
      })}
    </ScrollView>
  );
}

const COL_WIDTH = 92;

const styles = StyleSheet.create({
  strip: {
    gap: 8,
    paddingBottom: spacing.xs,
  },
  col: {
    width: COL_WIDTH,
    borderRadius: radius.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.hair,
    backgroundColor: colors.card,
    paddingVertical: 8,
    paddingHorizontal: 6,
    minHeight: 120,
  },
  colToday: {
    borderColor: colors.accent,
    backgroundColor: colors.accentSoft,
  },
  colWeekday: {
    fontFamily: fonts.mono,
    fontSize: 9,
    letterSpacing: 0.6,
    textTransform: "uppercase",
    color: colors.ink4,
    textAlign: "center",
  },
  colTodayText: { color: colors.accent },
  colDate: {
    fontSize: 18,
    fontWeight: "600",
    color: colors.ink2,
    textAlign: "center",
    marginBottom: 6,
  },
  colTodayNum: { color: colors.accent },
  events: { gap: 6, flex: 1 },
  colEmpty: {
    textAlign: "center",
    color: colors.ink4,
    fontSize: 12,
    marginTop: 8,
  },
  eventChip: {
    backgroundColor: colors.paper,
    borderRadius: 6,
    borderLeftWidth: 3,
    borderLeftColor: colors.accent,
    paddingHorizontal: 5,
    paddingVertical: 4,
  },
  eventPast: { opacity: 0.55 },
  eventPressed: { opacity: 0.85 },
  chipTime: {
    fontFamily: fonts.mono,
    fontSize: 9,
    color: colors.ink3,
  },
  chipTitle: {
    fontSize: 11,
    fontWeight: "600",
    color: colors.ink,
    lineHeight: 14,
  },
  empty: {
    fontSize: 14,
    color: colors.ink3,
    fontStyle: "italic",
  },
});
