// AlfredAvatar — design-sheet butler (SVG), not the writing-robot PNG mascot.
//
// Public API matches the web snippet:
//   <AlfredAvatar size={260} state="idle" />
//
// States map 1:1 from AvatarState (CompanionAvatarContext):
//   idle → Calm · thinking · focused · success → Happy+Approved · error · sleep

import { useEffect, useId, useRef } from "react";
import {
  Animated,
  Easing,
  Pressable,
  StyleSheet,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import Svg, {
  Circle,
  Defs,
  Ellipse,
  G,
  Line,
  Path,
  RadialGradient,
  Rect,
  Stop,
  Text as SvgText,
} from "react-native-svg";

import type { AvatarState } from "@/lib/agentMeta";
import { colors } from "@/theme/theme";

/** Palette from mobile/docs/assets/avatar-design-sheet.png */
export const ALFRED_SHEET = {
  white: "#F1F5FF",
  gray: "#E2E8F0",
  navy: "#08102D",
  sky: "#47BFF7",
  cape: "#93A5DB",
  capeShade: "#7487C2",
  mint: "#34B87C",
} as const;

export type AlfredAvatarProps = {
  /** Character height in logical pixels (width scales with viewBox). */
  size?: number;
  /** Mood — drives eyes / thinking ticks / approved check. */
  state?: AvatarState;
  /** Accent for bow tie + thinking marks (defaults to sheet sky blue). */
  color?: string;
  /** Dim + soft “away” treatment for center-tab when Alfred is elsewhere. */
  occupied?: boolean;
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
};

/**
 * Soft floating butler avatar. Prefer this over CompanionAvatar / alfred-mascot.png
 * for Home hero, Alfred hub, and the center tab button.
 */
export default function AlfredAvatar({
  size = 120,
  state = "idle",
  color = ALFRED_SHEET.sky,
  occupied = true,
  onPress,
  style,
  accessibilityLabel = "Alfred",
}: AlfredAvatarProps) {
  const breath = useRef(new Animated.Value(1)).current;
  const hover = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const toScale = state === "thinking" ? 1.05 : 1.025;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(breath, {
          toValue: toScale,
          duration: state === "thinking" ? 1100 : 1500,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
        Animated.timing(breath, {
          toValue: 1,
          duration: state === "thinking" ? 1100 : 1500,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [breath, state]);

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(hover, {
          toValue: state === "thinking" ? -4 : -3,
          duration: state === "thinking" ? 2200 : 2800,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
        Animated.timing(hover, {
          toValue: 0,
          duration: state === "thinking" ? 2200 : 2800,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [hover, state]);

  const height = Math.round(size * 1.07);
  const body = (
    <Animated.View
      style={[
        styles.wrap,
        style,
        {
          width: size,
          height,
          opacity: occupied ? (state === "sleep" ? 0.85 : 1) : 0.72,
          transform: [{ scale: breath }, { translateY: hover }],
        },
      ]}
      accessibilityLabel={accessibilityLabel}
    >
      <ButlerArt size={size} height={height} color={color} state={state} />
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

function ButlerArt({
  size,
  height,
  color,
  state,
}: {
  size: number;
  height: number;
  color: string;
  state: AvatarState;
}) {
  const uid = useId().replace(/:/g, "");
  const eyeGrad = `eye-${uid}`;

  return (
    <Svg width={size} height={height} viewBox="0 0 240 256">
      <Defs>
        <RadialGradient id={eyeGrad} cx="0.38" cy="0.32" r="0.85">
          <Stop offset="0" stopColor="#D9F2FF" />
          <Stop offset="0.55" stopColor="#8CC0FB" />
          <Stop offset="1" stopColor={ALFRED_SHEET.sky} />
        </RadialGradient>
      </Defs>

      <Ellipse
        cx={120}
        cy={246}
        rx={44}
        ry={8}
        fill="#19171A"
        opacity={0.1}
      />

      <G>
        {/* Cape */}
        <Path
          d="M88 150 Q46 178 58 222 Q70 214 80 220 Q90 212 100 218 L100 158 Z"
          fill={ALFRED_SHEET.cape}
        />
        <Path
          d="M152 150 Q194 178 182 222 Q170 214 160 220 Q150 212 140 218 L140 158 Z"
          fill={ALFRED_SHEET.cape}
        />
        <Path
          d="M92 152 Q70 180 76 212 L92 200 Z"
          fill={ALFRED_SHEET.capeShade}
          opacity={0.45}
        />
        <Path
          d="M148 152 Q170 180 164 212 L148 200 Z"
          fill={ALFRED_SHEET.capeShade}
          opacity={0.45}
        />

        {/* Feet */}
        <Ellipse
          cx={105}
          cy={216}
          rx={11}
          ry={8}
          fill={ALFRED_SHEET.white}
          stroke={ALFRED_SHEET.gray}
        />
        <Ellipse
          cx={135}
          cy={216}
          rx={11}
          ry={8}
          fill={ALFRED_SHEET.white}
          stroke={ALFRED_SHEET.gray}
        />

        {/* Tuxedo torso */}
        <Rect
          x={80}
          y={144}
          width={80}
          height={70}
          rx={26}
          fill={ALFRED_SHEET.navy}
        />
        <Path
          d="M104 144 L136 144 L133 200 Q120 207 107 200 Z"
          fill="#FFFFFF"
        />
        <Path
          d="M104 144 L120 162 L111 170 L101 150 Z"
          fill={ALFRED_SHEET.navy}
          opacity={0.92}
        />
        <Path
          d="M136 144 L120 162 L129 170 L139 150 Z"
          fill={ALFRED_SHEET.navy}
          opacity={0.92}
        />
        <Circle cx={120} cy={176} r={2.6} fill={ALFRED_SHEET.navy} />
        <Circle cx={120} cy={190} r={2.6} fill={ALFRED_SHEET.navy} />

        {/* Arms */}
        <Ellipse
          cx={73}
          cy={176}
          rx={11}
          ry={15}
          fill={ALFRED_SHEET.white}
          stroke={ALFRED_SHEET.gray}
        />
        <Ellipse
          cx={167}
          cy={176}
          rx={11}
          ry={15}
          fill={ALFRED_SHEET.white}
          stroke={ALFRED_SHEET.gray}
        />

        {/* Ears */}
        <Path
          d="M58 70 Q50 14 96 34 Q106 42 100 62 Z"
          fill={ALFRED_SHEET.white}
          stroke={ALFRED_SHEET.gray}
          strokeWidth={1.5}
        />
        <Path
          d="M182 70 Q190 14 144 34 Q134 42 140 62 Z"
          fill={ALFRED_SHEET.white}
          stroke={ALFRED_SHEET.gray}
          strokeWidth={1.5}
        />

        {/* Head */}
        <Rect
          x={44}
          y={44}
          width={152}
          height={118}
          rx={56}
          fill={ALFRED_SHEET.white}
          stroke={ALFRED_SHEET.gray}
          strokeWidth={1.5}
        />
        <Path
          d="M58 142 Q120 168 182 142 L182 150 Q120 174 58 150 Z"
          fill={ALFRED_SHEET.gray}
          opacity={0.45}
        />

        {/* Eye mask */}
        <Path
          d="M64 104 Q64 74 96 72 L144 72 Q176 74 176 104 Q176 132 142 134 L98 134 Q64 132 64 104 Z"
          fill={ALFRED_SHEET.navy}
        />
        <Ellipse cx={96} cy={83} rx={26} ry={9} fill="#FFFFFF" opacity={0.1} />

        <ButlerEyes state={state} eyeGrad={eyeGrad} />

        {/* Bow tie */}
        <Path
          d="M99 148 Q94 159 99 170 L117 162 Q119 159 117 156 Z"
          fill={color}
        />
        <Path
          d="M141 148 Q146 159 141 170 L123 162 Q121 159 123 156 Z"
          fill={color}
        />
        <Rect x={113} y={152} width={14} height={14} rx={5} fill={color} />
        <Rect
          x={113}
          y={152}
          width={14}
          height={6}
          rx={3}
          fill="#FFFFFF"
          opacity={0.25}
        />

        {state === "thinking" ? (
          <G>
            <Path
              d="M168 34 L160 16"
              stroke={color}
              strokeWidth={4}
              strokeLinecap="round"
            />
            <Path
              d="M182 38 L182 20"
              stroke={color}
              strokeWidth={4}
              strokeLinecap="round"
            />
            <Path
              d="M195 46 L204 30"
              stroke={color}
              strokeWidth={4}
              strokeLinecap="round"
            />
            <Circle
              cx={120}
              cy={130}
              r={114}
              stroke={color}
              strokeWidth={2}
              strokeDasharray="3 9"
              strokeOpacity={0.3}
              fill="none"
            />
          </G>
        ) : null}

        {state === "success" ? (
          <G>
            <Circle cx={192} cy={52} r={15} fill={ALFRED_SHEET.mint} />
            <Path
              d="M185 52 L190 58 L200 45"
              stroke="#FFFFFF"
              strokeWidth={3.6}
              fill="none"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </G>
        ) : null}

        {state === "error" ? (
          <Path
            d="M176 76 q7 12 0 17 q-7 -5 0 -17"
            fill="#BFE6FF"
            opacity={0.9}
          />
        ) : null}

        {state === "sleep" ? (
          <SvgText
            x={184}
            y={44}
            fontSize={17}
            fill={color}
            opacity={0.65}
            fontStyle="italic"
          >
            z z Z
          </SvgText>
        ) : null}
      </G>
    </Svg>
  );
}

function ButlerEyes({
  state,
  eyeGrad,
}: {
  state: AvatarState;
  eyeGrad: string;
}) {
  const arc = "#BFE0FF";

  if (state === "focused") {
    return (
      <G>
        <Path d="M82 100 a13 13 0 0 0 26 0 z" fill={`url(#${eyeGrad})`} />
        <Path d="M132 100 a13 13 0 0 0 26 0 z" fill={`url(#${eyeGrad})`} />
        <Line
          x1={80}
          y1={100}
          x2={110}
          y2={100}
          stroke={ALFRED_SHEET.navy}
          strokeWidth={3}
        />
        <Line
          x1={130}
          y1={100}
          x2={160}
          y2={100}
          stroke={ALFRED_SHEET.navy}
          strokeWidth={3}
        />
      </G>
    );
  }

  if (state === "thinking") {
    return (
      <G>
        <GlossyEye cx={101} cy={96} r={11} eyeGrad={eyeGrad} />
        <GlossyEye cx={149} cy={96} r={11} eyeGrad={eyeGrad} />
      </G>
    );
  }

  if (state === "success") {
    return (
      <G>
        <Path
          d="M82 109 Q95 94 108 109"
          stroke={arc}
          strokeWidth={7.5}
          fill="none"
          strokeLinecap="round"
        />
        <Path
          d="M132 109 Q145 94 158 109"
          stroke={arc}
          strokeWidth={7.5}
          fill="none"
          strokeLinecap="round"
        />
      </G>
    );
  }

  if (state === "error") {
    return (
      <G>
        <Path
          d="M82 99 Q95 111 108 99"
          stroke={arc}
          strokeWidth={6.5}
          fill="none"
          strokeLinecap="round"
        />
        <Path
          d="M132 99 Q145 111 158 99"
          stroke={arc}
          strokeWidth={6.5}
          fill="none"
          strokeLinecap="round"
        />
      </G>
    );
  }

  if (state === "sleep") {
    return (
      <G>
        <Path
          d="M83 104 Q95 112 107 104"
          stroke="#5E7CB8"
          strokeWidth={5.5}
          fill="none"
          strokeLinecap="round"
        />
        <Path
          d="M133 104 Q145 112 157 104"
          stroke="#5E7CB8"
          strokeWidth={5.5}
          fill="none"
          strokeLinecap="round"
        />
      </G>
    );
  }

  // idle → Calm
  return (
    <G>
      <GlossyEye cx={95} cy={103} r={13} eyeGrad={eyeGrad} />
      <GlossyEye cx={145} cy={103} r={13} eyeGrad={eyeGrad} />
    </G>
  );
}

function GlossyEye({
  cx,
  cy,
  r,
  eyeGrad,
}: {
  cx: number;
  cy: number;
  r: number;
  eyeGrad: string;
}) {
  return (
    <G>
      <Ellipse
        cx={cx}
        cy={cy}
        rx={r + 7}
        ry={r + 7}
        fill={ALFRED_SHEET.sky}
        opacity={0.25}
      />
      <Circle cx={cx} cy={cy} r={r} fill={`url(#${eyeGrad})`} />
      <Circle
        cx={cx - r * 0.32}
        cy={cy - r * 0.35}
        r={r * 0.26}
        fill="#FFFFFF"
        opacity={0.75}
      />
    </G>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: "center",
    justifyContent: "center",
  },
  pressed: { opacity: 0.88 },
});

/** Accent fallback aligned with app theme when meta.color is unset. */
export const alfredAccentFallback = colors.accent;
