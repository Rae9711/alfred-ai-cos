// Placeholder for tabs whose screens land in later slices.

import { StyleSheet, Text, View } from "react-native";

import { colors, spacing } from "@/theme/theme";

export function Placeholder({ title, note }: { title: string; note: string }) {
  return (
    <View style={styles.screen}>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.note}>{note}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.bg,
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.xl,
    gap: spacing.sm,
  },
  title: { color: colors.text, fontSize: 24, fontWeight: "700" },
  note: { color: colors.textMuted, fontSize: 14, textAlign: "center" },
});
