import { useEffect, useMemo, useRef } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import type { UpcomingMeeting } from "@albert/shared-types";

import {
  eventDurationMinutes,
  formatMonthDay,
  minutesFromMidnight,
  timelineHoursForItems,
  type ScheduleTimelineItem,
} from "@/lib/schedule";
import { colors, fonts, radius, spacing } from "@/theme/theme";

const HOUR_HEIGHT = 52;
const TIME_COL = 44;

function formatTime(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
}

export function DayScheduleView({
  day,
  items,
  onEventPress,
  onTaskPress,
  emptyText = "Nothing on the calendar for today.",
  showDayTitle = false,
}: {
  day: Date;
  items: ScheduleTimelineItem[];
  onEventPress: (event: UpcomingMeeting) => void;
  onTaskPress?: (taskId: string) => void;
  emptyText?: string;
  /** When false, date chrome lives in the parent week strip. */
  showDayTitle?: boolean;
}) {
  const scrollRef = useRef<ScrollView>(null);
  const isToday = useMemo(() => {
    const now = new Date();
    return (
      day.getFullYear() === now.getFullYear() &&
      day.getMonth() === now.getMonth() &&
      day.getDate() === now.getDate()
    );
  }, [day]);

  const { startHour, endHour } = useMemo(
    () => timelineHoursForItems(items),
    [items],
  );
  const hours = useMemo(
    () => Array.from({ length: endHour - startHour }, (_, i) => startHour + i),
    [startHour, endHour],
  );
  const gridHeight = hours.length * HOUR_HEIGHT;
  const nowMinutes = isToday ? new Date().getHours() * 60 + new Date().getMinutes() : -1;
  const nowTop =
    nowMinutes >= 0
      ? ((nowMinutes - startHour * 60) / 60) * HOUR_HEIGHT
      : -1;

  useEffect(() => {
    if (!isToday || nowTop < 0) return;
    const y = Math.max(0, nowTop - HOUR_HEIGHT * 2);
    const t = setTimeout(() => scrollRef.current?.scrollTo({ y, animated: true }), 120);
    return () => clearTimeout(t);
  }, [isToday, nowTop]);

  if (!items.length) {
    return <Text style={styles.empty}>{emptyText}</Text>;
  }

  return (
    <View style={styles.root}>
      {showDayTitle ? (
        <Text style={styles.dayTitle}>{formatMonthDay(day)}</Text>
      ) : null}
      <ScrollView
        ref={scrollRef}
        style={styles.scroll}
        nestedScrollEnabled
        showsVerticalScrollIndicator={false}
      >
        <View style={[styles.grid, { height: gridHeight }]}>
          {hours.map((h, i) => (
            <View key={h} style={[styles.hourRow, { top: i * HOUR_HEIGHT }]}>
              <Text style={styles.hourLabel}>
                {new Date(2000, 0, 1, h).toLocaleTimeString(undefined, {
                  hour: "numeric",
                })}
              </Text>
              <View style={styles.hourLine} />
            </View>
          ))}

          {isToday && nowTop >= 0 && nowTop <= gridHeight ? (
            <View style={[styles.nowRow, { top: nowTop }]}>
              <View style={styles.nowDot} />
              <View style={styles.nowLine} />
            </View>
          ) : null}

          {items.map((item) => {
            const top =
              ((minutesFromMidnight(item.start_time) - startHour * 60) / 60) *
              HOUR_HEIGHT;
            const height = Math.max(
              28,
              (eventDurationMinutes(item.start_time, item.end_time) / 60) *
                HOUR_HEIGHT -
                2,
            );
            const past =
              item.start_time != null &&
              new Date(item.start_time).getTime() < Date.now();
            const isTask = item.kind === "task";
            return (
              <Pressable
                key={item.id}
                onPress={() => {
                  if (isTask && item.task && onTaskPress) {
                    onTaskPress(item.task.id);
                    return;
                  }
                  if (item.event) onEventPress(item.event);
                }}
                style={({ pressed }) => [
                  styles.eventBlock,
                  isTask && styles.taskBlock,
                  { top: Math.max(0, top), height },
                  past && styles.eventPast,
                  pressed && styles.eventPressed,
                ]}
              >
                <Text style={[styles.eventTime, isTask && styles.taskTime]} numberOfLines={1}>
                  {formatTime(item.start_time)}
                  {isTask ? " · Reminder" : ""}
                </Text>
                <Text style={[styles.eventTitle, isTask && styles.taskTitle]} numberOfLines={2}>
                  {item.title}
                </Text>
                {!isTask && item.location?.trim() ? (
                  <Text style={styles.eventLocation} numberOfLines={1}>
                    {item.location.trim()}
                  </Text>
                ) : null}
              </Pressable>
            );
          })}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: spacing.sm },
  dayTitle: {
    fontFamily: fonts.mono,
    fontSize: 11,
    letterSpacing: 0.8,
    textTransform: "uppercase",
    color: colors.ink4,
  },
  scroll: { maxHeight: 360 },
  grid: {
    marginLeft: TIME_COL,
    position: "relative",
  },
  hourRow: {
    position: "absolute",
    left: -TIME_COL,
    right: 0,
    height: HOUR_HEIGHT,
    flexDirection: "row",
    alignItems: "flex-start",
  },
  hourLabel: {
    width: TIME_COL - 6,
    fontFamily: fonts.mono,
    fontSize: 10,
    color: colors.ink4,
    textAlign: "right",
    paddingRight: 6,
    marginTop: -6,
  },
  hourLine: {
    flex: 1,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.hair,
  },
  nowRow: {
    position: "absolute",
    left: -TIME_COL,
    right: 0,
    flexDirection: "row",
    alignItems: "center",
    zIndex: 2,
  },
  nowDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.warn,
    marginRight: 4,
  },
  nowLine: {
    flex: 1,
    height: 2,
    backgroundColor: colors.warn,
    opacity: 0.85,
  },
  eventBlock: {
    position: "absolute",
    left: 4,
    right: 4,
    backgroundColor: colors.accentSoft,
    borderLeftWidth: 3,
    borderLeftColor: colors.accent,
    borderRadius: radius.sm,
    paddingHorizontal: 8,
    paddingVertical: 4,
    overflow: "hidden",
    zIndex: 1,
  },
  taskBlock: {
    backgroundColor: colors.paper,
    borderLeftColor: colors.ink3,
    borderStyle: "dashed",
  },
  eventPast: { opacity: 0.6 },
  eventPressed: { opacity: 0.85 },
  eventTime: {
    fontFamily: fonts.mono,
    fontSize: 10,
    color: colors.accentInk,
  },
  taskTime: { color: colors.ink3 },
  eventTitle: {
    fontSize: 13,
    fontWeight: "600",
    color: colors.ink,
    lineHeight: 17,
  },
  taskTitle: { fontWeight: "500" },
  eventLocation: {
    fontSize: 11,
    color: colors.ink3,
    marginTop: 1,
  },
  empty: {
    fontSize: 14,
    color: colors.ink3,
    fontStyle: "italic",
  },
});
