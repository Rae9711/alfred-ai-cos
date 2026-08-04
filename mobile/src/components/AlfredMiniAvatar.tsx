// Center-tab / header Alfred — tuxedo robot PNG from wechat-reply-workflow
// (mobile/assets/alfred-mascot.png), same art as CompanionAvatar / butlerAvatarArt.

import { useEffect, useRef } from "react";
import {
  Animated,
  Easing,
  Image,
  Pressable,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native";

const MASCOT = require("../../assets/alfred-mascot.png");

export type AlfredMiniAvatarProps = {
  size?: number;
  occupied?: boolean;
  compact?: boolean;
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
};

export default function AlfredMiniAvatar({
  size = 84,
  occupied = true,
  compact: _compact = false,
  onPress,
  style,
  accessibilityLabel = "Alfred",
}: AlfredMiniAvatarProps) {
  const hover = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(hover, {
          toValue: -3,
          duration: 2800,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
        Animated.timing(hover, {
          toValue: 0,
          duration: 2800,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [hover]);

  const body = (
    <Animated.View
      style={[
        styles.root,
        style,
        {
          width: size,
          height: size,
          opacity: occupied ? 1 : 0.72,
          transform: [{ translateY: hover }],
        },
      ]}
      accessibilityLabel={accessibilityLabel}
    >
      <Image
        source={MASCOT}
        style={{ width: size, height: size }}
        resizeMode="contain"
        accessibilityIgnoresInvertColors
      />
    </Animated.View>
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

const styles = StyleSheet.create({
  root: {
    position: "relative",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#2D3D5A",
    shadowOpacity: 0.14,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 8 },
  },
  pressed: { opacity: 0.88 },
});
