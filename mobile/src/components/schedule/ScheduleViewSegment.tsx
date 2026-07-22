import { Pressable, StyleSheet, Text, View } from "react-native";

import type { ScheduleView } from "@/lib/schedule";
import { fonts } from "@/theme/theme";

const VIEWS: ScheduleView[] = ["day", "week", "month"];

export function ScheduleViewSegment({
  value,
  labels,
  onChange,
}: {
  value: ScheduleView;
  labels: Record<ScheduleView, string>;
  onChange: (view: ScheduleView) => void;
}) {
  return (
    <View style={styles.track}>
      {VIEWS.map((view) => {
        const selected = value === view;
        return (
          <Pressable
            key={view}
            onPress={() => onChange(view)}
            style={[styles.segment, selected && styles.segmentSelected]}
            accessibilityRole="button"
            accessibilityState={{ selected }}
          >
            <Text style={[styles.label, selected && styles.labelSelected]}>
              {labels[view]}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#EFEFEF",
    borderRadius: 999,
    padding: 3,
  },
  segment: {
    minWidth: 36,
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
  },
  segmentSelected: {
    backgroundColor: "#FFFFFF",
    shadowColor: "#000000",
    shadowOpacity: 0.08,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 1 },
    elevation: 2,
  },
  label: {
    fontFamily: fonts.sansMedium,
    fontSize: 13,
    color: "#8E8E8E",
  },
  labelSelected: {
    color: "#3A3A3A",
  },
});
