// Icon tile — port of alfred-ui-system IconTile (.icon-tile + .tone-*).

import type { ComponentType, ReactNode } from "react";
import {
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";

import { colors, fonts } from "@/theme/theme";

export type AlfredIconTone = "blue" | "purple" | "green" | "yellow" | "neutral";

/** @deprecated Prefer `tone`. Mapped: dimensional→blue, assistant→purple, dark→blue active. */
export type AlfredIconVariant =
  | "dimensional"
  | "minimal"
  | "assistant"
  | "dark";

export type AlfredIconSize = "small" | "medium" | "large" | "sm" | "md" | "lg";

export type AlfredIconGlyph = ComponentType<{
  size?: number;
  color?: string;
  stroke?: number;
}>;

type SizeTokens = {
  box: number;
  symbol: number;
  radius: number;
};

const SIZE: Record<"sm" | "md" | "lg", SizeTokens> = {
  sm: { box: 38, symbol: 17, radius: 13 },
  md: { box: 50, symbol: 22, radius: 16 },
  lg: { box: 62, symbol: 26, radius: 20 },
};

function normalizeSize(size: AlfredIconSize): "sm" | "md" | "lg" {
  if (size === "small" || size === "sm") return "sm";
  if (size === "large" || size === "lg") return "lg";
  return "md";
}

function resolveTone(
  tone: AlfredIconTone | undefined,
  variant: AlfredIconVariant,
): AlfredIconTone {
  if (tone) return tone;
  if (variant === "assistant") return "purple";
  if (variant === "minimal") return "neutral";
  return "blue";
}

const TONE_COLORS: Record<
  AlfredIconTone,
  { ink: string; from: string; to: string }
> = {
  blue: { ink: colors.toneBlue, from: "#FFFFFF", to: "#E8F0FF" },
  purple: { ink: colors.tonePurple, from: "#FFFFFF", to: "#EEEAFF" },
  green: { ink: colors.toneGreen, from: "#FFFFFF", to: "#E5F7EC" },
  yellow: { ink: colors.toneYellow, from: "#FFFFFF", to: "#FFF3D5" },
  neutral: { ink: colors.toneNeutral, from: "#FFFFFF", to: "#EFEFED" },
};

export function AlfredIcon({
  icon: Icon,
  tone,
  variant = "dimensional",
  size = "medium",
  notification,
  badge,
  active = false,
  label,
  onPress,
  style,
  children,
}: {
  icon?: AlfredIconGlyph;
  tone?: AlfredIconTone;
  variant?: AlfredIconVariant;
  size?: AlfredIconSize;
  notification?: number;
  /** Alias for notification — matches IconTile API. */
  badge?: number;
  active?: boolean;
  label?: string;
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
  children?: ReactNode;
}) {
  const tok = SIZE[normalizeSize(size)];
  const resolved = resolveTone(tone, variant);
  const palette = TONE_COLORS[resolved];
  const count = notification ?? badge;
  const isDark = variant === "dark" || (variant === "dimensional" && active);
  const color = isDark ? "#FFFFFF" : palette.ink;
  const stroke = variant === "minimal" ? 1.9 : 2.1;

  const glyph =
    children ??
    (Icon ? (
      <Icon size={tok.symbol} color={color} stroke={stroke} />
    ) : null);

  const body = (
    <View
      style={[
        styles.base,
        {
          width: tok.box,
          height: tok.box,
          borderRadius: tok.radius,
        },
        isDark ? styles.dark : styles.tile,
        style,
      ]}
      accessibilityLabel={label}
    >
      {!isDark ? (
        <LinearGradient
          colors={[palette.from, palette.to]}
          start={{ x: 0.15, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={[
            StyleSheet.absoluteFillObject,
            { borderRadius: tok.radius },
          ]}
        />
      ) : (
        <LinearGradient
          colors={["#5288EE", "#245ACB"]}
          start={{ x: 0.2, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={[
            StyleSheet.absoluteFillObject,
            { borderRadius: tok.radius },
          ]}
        />
      )}

      <View
        pointerEvents="none"
        style={[styles.gloss, { borderRadius: tok.radius - 1 }]}
      >
        <LinearGradient
          colors={["rgba(255,255,255,0.75)", "rgba(255,255,255,0)"]}
          start={{ x: 0.1, y: 0 }}
          end={{ x: 0.7, y: 0.55 }}
          style={StyleSheet.absoluteFillObject}
        />
      </View>

      <View style={styles.symbol}>{glyph}</View>

      {typeof count === "number" && count > 0 ? (
        <View style={styles.badge}>
          <Text style={styles.badgeText}>
            {count > 99 ? "99+" : count}
          </Text>
        </View>
      ) : null}
    </View>
  );

  if (!onPress) return body;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [pressed && styles.pressed]}
    >
      {body}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    alignItems: "center",
    justifyContent: "center",
    position: "relative",
    overflow: "visible",
  },
  pressed: {
    opacity: 0.92,
    transform: [{ scale: 0.96 }],
  },
  symbol: {
    zIndex: 2,
  },
  gloss: {
    ...StyleSheet.absoluteFillObject,
    margin: 1,
    overflow: "hidden",
    zIndex: 1,
    // Approximate linear-gradient(160deg, rgba(255,255,255,.75), transparent 45%)
    borderTopWidth: 0,
    backgroundColor: "transparent",
    borderColor: "transparent",
  },
  tile: {
    borderWidth: 1,
    borderColor: "rgba(74,88,117,0.09)",
    shadowColor: "#2D3D5A",
    shadowOpacity: 0.12,
    shadowRadius: 9,
    shadowOffset: { width: 0, height: 8 },
    elevation: 5,
  },
  dark: {
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.2)",
    shadowColor: "#245ACB",
    shadowOpacity: 0.28,
    shadowRadius: 13,
    shadowOffset: { width: 0, height: 10 },
    elevation: 8,
  },
  badge: {
    minWidth: 18,
    height: 18,
    paddingHorizontal: 5,
    position: "absolute",
    top: -5,
    right: -5,
    zIndex: 4,
    borderRadius: 999,
    borderWidth: 2,
    borderColor: colors.paper,
    backgroundColor: colors.accent,
    alignItems: "center",
    justifyContent: "center",
  },
  badgeText: {
    fontFamily: fonts.sansSemibold,
    fontSize: 8,
    lineHeight: 10,
    color: "#fff",
  },
});
