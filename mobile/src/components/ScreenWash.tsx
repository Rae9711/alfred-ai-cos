// Full-screen near-neutral paper wash — quiet depth behind glass / paper cards.
// Two-stop vertical stone + soft vignette. No teal, purple, or mesh.

import { useState } from "react";
import { StyleSheet, View, type LayoutChangeEvent, type ViewStyle } from "react-native";
import Svg, { Defs, LinearGradient, RadialGradient, Rect, Stop } from "react-native-svg";

import { colors } from "@/theme/theme";

type Props = {
  style?: ViewStyle;
};

export function ScreenWash({ style }: Props) {
  const [size, setSize] = useState({ w: 1, h: 1 });

  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    if (width > 0 && height > 0 && (width !== size.w || height !== size.h)) {
      setSize({ w: width, h: height });
    }
  };

  return (
    <View
      pointerEvents="none"
      onLayout={onLayout}
      style={[StyleSheet.absoluteFillObject, style]}
    >
      <Svg width={size.w} height={size.h}>
        <Defs>
          <LinearGradient id="paperWash" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={colors.washTop} />
            <Stop offset="0.42" stopColor={colors.washMid} />
            <Stop offset="1" stopColor={colors.washBottom} />
          </LinearGradient>
          <RadialGradient
            id="paperVignette"
            cx="50%"
            cy="38%"
            rx="78%"
            ry="72%"
          >
            <Stop offset="0" stopColor="#1C1A18" stopOpacity="0" />
            <Stop offset="1" stopColor="#1C1A18" stopOpacity="0.045" />
          </RadialGradient>
        </Defs>
        <Rect x={0} y={0} width={size.w} height={size.h} fill="url(#paperWash)" />
        <Rect
          x={0}
          y={0}
          width={size.w}
          height={size.h}
          fill="url(#paperVignette)"
        />
      </Svg>
    </View>
  );
}
