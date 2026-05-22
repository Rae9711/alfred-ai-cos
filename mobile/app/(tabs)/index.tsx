// The tab container, built from plain primitives. No native navigator.
//
// Expo Go SDK 54 forces the New Architecture, under which expo-router's <Tabs> bar
// (react-native-screens) throws "expected dynamic type 'boolean', but had type 'string'"
// on render. So we render the active screen via local state and draw a custom bottom bar
// of View/Pressable/Text. The sibling (tabs)/{capture,waiting,settings}.tsx files are
// retained for a future migration back to a native tab bar in a dev build.

import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { CaptureScreen } from "@/screens/CaptureScreen";
import { SettingsScreen } from "@/screens/SettingsScreen";
import { TodayScreen } from "@/screens/TodayScreen";
import { WaitingScreen } from "@/screens/WaitingScreen";
import { colors, spacing } from "@/theme/theme";

type TabKey = "today" | "capture" | "waiting" | "settings";

const TABS: { key: TabKey; label: string }[] = [
  { key: "today", label: "Today" },
  { key: "capture", label: "Capture" },
  { key: "waiting", label: "Waiting" },
  { key: "settings", label: "Settings" },
];

export default function TabsHome() {
  const [tab, setTab] = useState<TabKey>("today");

  return (
    <View style={styles.root}>
      <View style={styles.content}>
        {tab === "today" ? <TodayScreen /> : null}
        {tab === "capture" ? <CaptureScreen /> : null}
        {tab === "waiting" ? <WaitingScreen /> : null}
        {tab === "settings" ? <SettingsScreen /> : null}
      </View>
      <View style={styles.bar}>
        {TABS.map((t) => {
          const active = t.key === tab;
          return (
            <Pressable
              key={t.key}
              style={styles.tab}
              onPress={() => setTab(t.key)}
            >
              <Text style={[styles.label, active && styles.labelActive]}>
                {t.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  content: { flex: 1 },
  bar: {
    flexDirection: "row",
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.surface,
    paddingBottom: spacing.lg,
    paddingTop: spacing.sm,
  },
  tab: { flex: 1, alignItems: "center", paddingVertical: spacing.xs },
  label: { color: colors.textMuted, fontSize: 12 },
  labelActive: { color: colors.accent, fontWeight: "700" },
});
