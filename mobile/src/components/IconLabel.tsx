// Icon + title + description row — port of alfred-ui-system summary/inbox rows.

import {
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native";

import {
  AlfredIcon,
  type AlfredIconGlyph,
  type AlfredIconTone,
  type AlfredIconVariant,
} from "@/components/AlfredIcon";
import { colors, fonts } from "@/theme/theme";

export function IconLabel({
  icon,
  title,
  description,
  tone = "blue",
  variant = "dimensional",
  active = false,
  onPress,
  style,
}: {
  icon: AlfredIconGlyph;
  title: string;
  description?: string;
  tone?: AlfredIconTone;
  variant?: AlfredIconVariant;
  active?: boolean;
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      style={({ pressed }) => [
        styles.row,
        active && styles.active,
        pressed && onPress ? styles.pressed : null,
        style,
      ]}
      accessibilityRole={onPress ? "button" : undefined}
      accessibilityLabel={description ? `${title}. ${description}` : title}
    >
      <AlfredIcon
        icon={icon}
        tone={tone}
        variant={variant}
        size="medium"
        active={active}
      />
      <View style={styles.copy}>
        <Text style={styles.title} numberOfLines={1}>
          {title}
        </Text>
        {description ? (
          <Text style={styles.description} numberOfLines={1}>
            {description}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    width: "100%",
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 11,
    paddingHorizontal: 13,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "transparent",
    backgroundColor: "transparent",
  },
  active: {
    borderColor: "rgba(157,147,127,0.13)",
    backgroundColor: "rgba(255,253,249,0.94)",
  },
  pressed: {
    transform: [{ translateY: -1 }],
    borderColor: "rgba(157,147,127,0.1)",
    backgroundColor: "rgba(255,250,244,0.75)",
  },
  copy: {
    flex: 1,
    minWidth: 0,
    gap: 4,
  },
  title: {
    fontFamily: fonts.sansSemibold,
    fontSize: 14,
    letterSpacing: -0.2,
    color: colors.ink,
  },
  description: {
    fontFamily: fonts.sans,
    fontSize: 11,
    color: colors.ink3,
  },
});
