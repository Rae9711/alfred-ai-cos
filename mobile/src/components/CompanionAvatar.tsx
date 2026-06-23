// Alfred's companion avatar — "Light Airy Butler" + cloud cottage home.
//
// Vector art ported from mobile/demo/avatar-sim/sim.ts (react-native-svg).
// Placements (controlled by parent screens):
//   • today  — top-right greeting chip ("Hi!")
//   • ask    — bottom-right while chatting
//   • home   — cloud cottage in the center tab slot (butler peeks out on Inbox / You)

import { useEffect, useRef } from "react";
import {
  Animated,
  Easing,
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native";

import { ButlerSvg, CloudHomeSvg } from "@/components/butlerAvatarArt";
import { getFormByLevel, getLevelFx, type AvatarState } from "@/lib/agentMeta";
import { colors, fonts } from "@/theme/theme";

export type CompanionAvatarProps = {
  /** Character height in logical pixels. */
  size?: number;
  /** Agent level — selects evolution halo styling. */
  level?: number;
  /** Theme tint for bow tie / flag; defaults to accent blue. */
  color?: string;
  /** Current mood — affects face and subtle motion. */
  state?: AvatarState;
  /** Optional speech bubble text (e.g. "Hi!" on Today). */
  speech?: string;
  /** When true, hides extra chrome (Ask dock). */
  compact?: boolean;
  /** Called when the user taps the avatar (future: open growth hub). */
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
  /** Accessibility label override. */
  accessibilityLabel?: string;
};

/**
 * Floating companion avatar: butler + optional speech bubble.
 * Wrap in a positioned parent (absolute top-right, bottom-right, etc.).
 */
export function CompanionAvatar({
  size = 56,
  level = 1,
  color = colors.accent,
  state = "idle",
  speech,
  compact = false,
  onPress,
  style,
  accessibilityLabel = "Alfred companion avatar",
}: CompanionAvatarProps) {
  const levelFx = getLevelFx(level);
  const form = getFormByLevel(level);

  // Breathing scale — stronger while thinking (matches the design sim).
  const breath = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    const toValue = state === "thinking" ? 1.06 : 1.03;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(breath, {
          toValue,
          duration: state === "thinking" ? 1100 : 1400,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
        Animated.timing(breath, {
          toValue: 1,
          duration: state === "thinking" ? 1100 : 1400,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [breath, state]);

  const scaledSize = size * levelFx.scale;

  const body = (
    <View style={[styles.wrap, style]} accessibilityLabel={accessibilityLabel}>
      {speech ? (
        <View style={styles.bubble}>
          <Text style={styles.bubbleText}>{speech}</Text>
          <View style={styles.bubbleTail} />
        </View>
      ) : null}

      <Animated.View
        style={{
          transform: [{ scale: breath }],
          shadowColor: color,
          shadowOpacity: levelFx.glowAlpha,
          shadowRadius: levelFx.glowBlur * 0.35,
          shadowOffset: { width: 0, height: 4 },
        }}
      >
        <ButlerSvg
          size={scaledSize}
          color={color}
          level={level}
          state={state}
        />
      </Animated.View>

      <Text style={styles.srOnly}>{form.name}</Text>
    </View>
  );

  if (onPress) {
    return (
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        style={({ pressed }) => (pressed ? styles.pressed : undefined)}
      >
        {body}
      </Pressable>
    );
  }

  return body;
}

/** Cloud cottage for the tab bar — butler peeks out when occupied (Inbox / You). */
export function CompanionAvatarHome({
  size = 54,
  color = colors.accent,
  state = "idle",
  occupied = false,
}: Pick<CompanionAvatarProps, "size" | "color" | "state"> & {
  occupied?: boolean;
}) {
  return (
    <View
      style={styles.homeSlot}
      accessibilityLabel={
        occupied
          ? "Alfred companion home — open capture"
          : "Alfred away working — open capture"
      }
    >
      <CloudHomeSvg
        size={size}
        color={color}
        occupied={occupied}
        state={state}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: "relative",
    alignItems: "center",
    gap: 2,
  },
  pressed: { opacity: 0.85 },
  homeSlot: {
    alignItems: "center",
    justifyContent: "center",
  },

  bubble: {
    position: "absolute",
    right: "100%",
    top: 4,
    marginRight: 8,
    backgroundColor: colors.card,
    borderRadius: 14,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.hair2,
    maxWidth: 120,
    shadowColor: "#19171A",
    shadowOpacity: 0.06,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    zIndex: 2,
  },
  bubbleText: {
    fontFamily: fonts.serif,
    fontSize: 15,
    fontStyle: "italic",
    color: colors.accentInk,
  },
  bubbleTail: {
    position: "absolute",
    right: -5,
    top: 12,
    width: 10,
    height: 10,
    backgroundColor: colors.card,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderColor: colors.hair2,
    transform: [{ rotate: "45deg" }],
  },

  srOnly: {
    position: "absolute",
    width: 1,
    height: 1,
    opacity: 0,
  },
});
