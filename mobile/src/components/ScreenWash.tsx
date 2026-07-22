// Warm cream paper wash — alfred-ui-system body gradient.
// #f5f2ec → #ece8df with soft top-center white radial.

import { useState } from "react";
import { StyleSheet, View, type LayoutChangeEvent, type ViewStyle } from "react-native";
import Svg, { Circle, Defs, LinearGradient, RadialGradient, Rect, Stop } from "react-native-svg";

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

  const orbR = Math.max(140, size.w * 0.55);

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
            <Stop offset="0.5" stopColor={colors.washMid} />
            <Stop offset="1" stopColor={colors.washBottom} />
          </LinearGradient>
          <RadialGradient
            id="topGlow"
            cx="50%"
            cy="0%"
            rx="55%"
            ry="35%"
          >
            <Stop offset="0" stopColor="#FFFFFF" stopOpacity={0.85} />
            <Stop offset="1" stopColor="#FFFFFF" stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Rect x={0} y={0} width={size.w} height={size.h} fill="url(#paperWash)" />
        <Rect x={0} y={0} width={size.w} height={size.h} fill="url(#topGlow)" />
        <Circle
          cx={size.w * 0.85}
          cy={size.h * 0.12}
          r={orbR * 0.45}
          fill={colors.orbTwo}
        />
      </Svg>
    </View>
  );
}
