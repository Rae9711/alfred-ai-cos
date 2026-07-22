// Alfred's companion avatar — wraps AlfredAvatar (design-sheet butler SVG).
//
// Placements (controlled by parent screens):
//   • today  — top-right greeting chip ("Hi!")
//   • ask    — bottom-right while chatting
//   • home   — center tab slot (Alfred hub entry)

import { useRef, useState } from "react";
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

import AlfredAvatar from "@/components/AlfredAvatar";
import { getFormByLevel, getLevelFx, type AvatarState } from "@/lib/agentMeta";
import { colors, fonts } from "@/theme/theme";

export type CompanionAvatarProps = {
  /** Character height in logical pixels. */
  size?: number;
  /** Agent level — selects evolution halo styling. */
  level?: number;
  /** Theme tint for bow tie; defaults to accent blue. */
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
 * Floating companion: AlfredAvatar + optional speech bubble.
 * Prefer importing AlfredAvatar directly for new surfaces.
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
  void compact;

  const scaledSize = size * levelFx.scale;

  const body = (
    <View style={[styles.wrap, style]} accessibilityLabel={accessibilityLabel}>
      {speech ? (
        <View style={styles.bubble}>
          <Text style={styles.bubbleText}>{speech}</Text>
          <View style={styles.bubbleTail} />
        </View>
      ) : null}

      <View
        style={{
          shadowColor: color,
          shadowOpacity: levelFx.glowAlpha,
          shadowRadius: levelFx.glowBlur * 0.35,
          shadowOffset: { width: 0, height: 4 },
        }}
      >
        <AlfredAvatar
          size={scaledSize}
          color={color}
          state={state}
          accessibilityLabel={accessibilityLabel}
        />
      </View>

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

/** Brief thinking mood on center-tab tap before navigation (T-AV1). */
export const COMPANION_HOME_TAP_THINKING_MS = 320;

/** Center-tab Alfred — AlfredAvatar with tap flash + occupied dimming. */
export function CompanionAvatarHome({
  size = 54,
  color = colors.accent,
  state = "idle",
  occupied = false,
  onPress,
  accessibilityLabel = occupied
    ? "Alfred companion home — open capture"
    : "Alfred away working — open capture",
}: Pick<CompanionAvatarProps, "size" | "color" | "state"> & {
  occupied?: boolean;
  onPress?: () => void;
  accessibilityLabel?: string;
}) {
  const [tapFlash, setTapFlash] = useState(false);
  const pending = useRef(false);
  const bounce = useRef(new Animated.Value(1)).current;

  const handlePress = () => {
    if (!onPress || pending.current) return;
    pending.current = true;
    setTapFlash(true);
    Animated.sequence([
      Animated.timing(bounce, {
        toValue: 0.92,
        duration: 80,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }),
      Animated.spring(bounce, {
        toValue: 1,
        friction: 4,
        tension: 140,
        useNativeDriver: true,
      }),
    ]).start();
    setTimeout(() => {
      onPress();
      setTapFlash(false);
      pending.current = false;
    }, COMPANION_HOME_TAP_THINKING_MS);
  };

  const displayState = tapFlash ? "thinking" : state;
  const displayOccupied = occupied || tapFlash;

  const content = (
    <Animated.View
      style={[styles.homeSlot, { transform: [{ scale: bounce }] }]}
    >
      <AlfredAvatar
        size={size}
        color={color}
        state={displayState}
        occupied={displayOccupied}
        accessibilityLabel={accessibilityLabel}
      />
    </Animated.View>
  );

  if (!onPress) {
    return (
      <View style={styles.homeSlot} accessibilityLabel={accessibilityLabel}>
        <AlfredAvatar
          size={size}
          color={color}
          occupied={occupied}
          state={state}
          accessibilityLabel={accessibilityLabel}
        />
      </View>
    );
  }

  return (
    <Pressable
      onPress={handlePress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
    >
      {content}
    </Pressable>
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
