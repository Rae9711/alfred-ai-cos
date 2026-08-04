import { useMemo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import {
  formatWeekdayShort,
  isSameDay,
  weekDaysMondayFirst,
} from "@/lib/schedule";
import { colors, fonts } from "@/theme/theme";

export function ScheduleWeekStrip({
  selectedDay,
  onSelectDay,
  anchor,
}: {
  selectedDay: Date;
  onSelectDay: (day: Date) => void;
  /** Week containing this date (defaults to selectedDay). */
  anchor?: Date;
}) {
  const days = useMemo(
    () => weekDaysMondayFirst(anchor ?? selectedDay),
    [anchor, selectedDay],
  );

  return (
    <View style={styles.strip}>
      {days.map((day) => {
        const selected = isSameDay(day, selectedDay);
        const abbr = formatWeekdayShort(day);
        const num = String(day.getDate());
        return (
          <Pressable
            key={day.toISOString()}
            onPress={() => onSelectDay(day)}
            style={styles.cell}
            accessibilityRole="button"
            accessibilityState={{ selected }}
            accessibilityLabel={`${abbr} ${num}`}
          >
            {selected ? (
              <View style={styles.capsule}>
                <Text style={styles.capsuleAbbr}>{abbr}</Text>
                <View style={styles.capsuleCircle}>
                  <Text style={styles.capsuleNum}>{num}</Text>
                </View>
              </View>
            ) : (
              <View style={styles.plain}>
                <Text style={styles.plainAbbr}>{abbr}</Text>
                <Text style={styles.plainNum}>{num}</Text>
              </View>
            )}
          </Pressable>
        );
      })}
    </View>
  );
}

const CAPSULE_W = 40;
const CAPSULE_H = 68;
const CIRCLE = 28;

const styles = StyleSheet.create({
  strip: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 4,
    minHeight: CAPSULE_H,
  },
  cell: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  plain: {
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 10,
  },
  plainAbbr: {
    fontFamily: fonts.sans,
    fontSize: 12,
    color: "#A8A8A8",
  },
  plainNum: {
    fontFamily: fonts.sansSemibold,
    fontSize: 16,
    color: colors.ink,
  },
  capsule: {
    width: CAPSULE_W,
    height: CAPSULE_H,
    borderRadius: CAPSULE_W / 2,
    backgroundColor: "#111111",
    alignItems: "center",
    justifyContent: "space-between",
    paddingTop: 10,
    paddingBottom: 6,
  },
  capsuleAbbr: {
    fontFamily: fonts.sansMedium,
    fontSize: 11,
    color: "#FFFFFF",
  },
  capsuleCircle: {
    width: CIRCLE,
    height: CIRCLE,
    borderRadius: CIRCLE / 2,
    backgroundColor: "#FFFFFF",
    alignItems: "center",
    justifyContent: "center",
  },
  capsuleNum: {
    fontFamily: fonts.sansSemibold,
    fontSize: 13,
    color: "#111111",
  },
});
