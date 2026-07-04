// Alfred robot mascot — raster reference art with SVG mood overlays.
// Public API: ButlerSvg (Today / Ask / Capture) and CloudHomeSvg (center tab slot).

import { useEffect, useId, useRef } from "react";
import { Animated, Easing, Image, StyleSheet, View } from "react-native";
import Svg, {
  Circle,
  Defs,
  Ellipse,
  G,
  Path,
  RadialGradient,
  Stop,
  Text as SvgText,
} from "react-native-svg";

import type { AvatarState } from "@/lib/agentMeta";

const MASCOT = require("../../assets/alfred-mascot.png");

/** Mascot palette — kept for theme tint overlays. */
export const BUTLER_SHEET = {
  white: "#F8FAFF",
  bodyShade: "#D8E2EE",
  screen: "#121212",
  blush: "#F5A8B8",
  antenna: "#1A1A1A",
  sky: "#4787F7",
} as const;

const GLOW_BLUE = "#BFE0FF";

type ButlerSvgProps = {
  size: number;
  color: string;
  level: number;
  state: AvatarState;
};

type CloudHomeSvgProps = {
  size: number;
  color: string;
  occupied: boolean;
  state: AvatarState;
};

/** Full robot character — Today header, Ask dock, Capture hero. */
export function ButlerSvg({ size, color, level, state }: ButlerSvgProps) {
  const dim = state === "sleep" ? 0.85 : 1;
  const hover = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(hover, {
          toValue: -3,
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

  return (
    <Animated.View style={{ transform: [{ translateY: hover }], opacity: dim }}>
      <MascotArt size={size} color={color} level={level} state={state} />
    </Animated.View>
  );
}

/** Center tab slot — same mascot, dimmed when Alfred is away. */
export function CloudHomeSvg({
  size,
  color,
  occupied,
  state,
}: CloudHomeSvgProps) {
  const hover = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(hover, {
          toValue: -2,
          duration: state === "thinking" ? 2200 : 4400,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
        Animated.timing(hover, {
          toValue: 0,
          duration: state === "thinking" ? 2200 : 4400,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [hover, state]);

  return (
    <Animated.View style={{ transform: [{ translateY: hover }] }}>
      <MascotArt
        size={size}
        color={color}
        level={1}
        state={state}
        away={!occupied}
      />
    </Animated.View>
  );
}

function MascotArt({
  size,
  color,
  level,
  state,
  away = false,
}: {
  size: number;
  color: string;
  level: number;
  state: AvatarState;
  away?: boolean;
}) {
  return (
    <View
      style={[
        styles.frame,
        {
          width: size,
          height: size,
          opacity: away ? 0.72 : 1,
        },
      ]}
    >
      <Image
        source={MASCOT}
        style={{ width: size, height: size }}
        resizeMode="contain"
        accessibilityIgnoresInvertColors
      />
      <View style={StyleSheet.absoluteFill} pointerEvents="none">
        <MoodOverlay size={size} color={color} state={state} />
        <LevelFx size={size} color={color} level={level} />
        {away ? <AwayBadge size={size} color={color} /> : null}
      </View>
    </View>
  );
}

function MoodOverlay({
  size,
  color,
  state,
}: {
  size: number;
  color: string;
  state: AvatarState;
}) {
  const uid = useId().replace(/:/g, "");
  const eyeGrad = `eye-${uid}`;

  if (state === "idle") return null;

  return (
    <Svg width={size} height={size} viewBox="0 0 100 100">
      <Defs>
        <RadialGradient id={eyeGrad} cx="0.38" cy="0.32" r="0.85">
          <Stop offset="0" stopColor="#D9F2FF" />
          <Stop offset="0.55" stopColor="#8CC0FB" />
          <Stop offset="1" stopColor={color} />
        </RadialGradient>
      </Defs>

      {state === "thinking" ? (
        <G>
          <FaceEyes state="thinking" eyeGrad={eyeGrad} />
          <Path
            d="M72 14 L68 6"
            stroke={color}
            strokeWidth="1.8"
            strokeLinecap="round"
          />
          <Path
            d="M80 12 L80 4"
            stroke={color}
            strokeWidth="1.8"
            strokeLinecap="round"
          />
          <Path
            d="M88 14 L92 6"
            stroke={color}
            strokeWidth="1.8"
            strokeLinecap="round"
          />
          <Circle
            cx="50"
            cy="52"
            r="47"
            stroke={color}
            strokeWidth="0.8"
            strokeDasharray="1.5 4"
            strokeOpacity="0.28"
            fill="none"
          />
        </G>
      ) : null}

      {state === "focused" ? (
        <G>
          <FaceEyes state="focused" eyeGrad={eyeGrad} />
          <Path
            d="M38 28 L42 28"
            stroke={color}
            strokeWidth="1.2"
            strokeLinecap="round"
          />
          <Path
            d="M58 28 L62 28"
            stroke={color}
            strokeWidth="1.2"
            strokeLinecap="round"
          />
        </G>
      ) : null}

      {state === "success" ? (
        <G>
          <Circle cx="82" cy="18" r="7" fill="#34B87C" />
          <Path
            d="M77.5 18 L80.5 21.5 L87 14.5"
            stroke="#FFFFFF"
            strokeWidth="1.8"
            fill="none"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </G>
      ) : null}

      {state === "error" ? (
        <G>
          <FaceEyes state="error" eyeGrad={eyeGrad} />
          <Path
            d="M84 24 q3.5 6 0 8.5 q-3.5 -2.5 0 -8.5"
            fill="#BFE6FF"
            opacity="0.9"
          />
        </G>
      ) : null}

      {state === "sleep" ? (
        <G>
          <FaceEyes state="sleep" eyeGrad={eyeGrad} />
          <SvgText
            x="84"
            y="16"
            fontSize="7"
            fill={color}
            opacity="0.65"
            fontStyle="italic"
          >
            z z Z
          </SvgText>
        </G>
      ) : null}
    </Svg>
  );
}

function FaceEyes({
  state,
  eyeGrad,
}: {
  state: "thinking" | "focused" | "error" | "sleep";
  eyeGrad: string;
}) {
  const left = 42;
  const right = 58;
  const y = 31;

  if (state === "thinking") {
    return (
      <G>
        <Circle cx={left} cy={y} r="3.2" fill={`url(#${eyeGrad})`} />
        <Circle cx={right} cy={y} r="3.2" fill={`url(#${eyeGrad})`} />
        <Path
          d="M44 36 Q50 33 56 36"
          stroke={GLOW_BLUE}
          strokeWidth="1.4"
          fill="none"
          strokeLinecap="round"
        />
      </G>
    );
  }

  if (state === "focused") {
    return (
      <G>
        <Circle cx={left} cy={y} r="3" fill={`url(#${eyeGrad})`} />
        <Circle cx={right} cy={y} r="3" fill={`url(#${eyeGrad})`} />
        <Path
          d="M46 36 L54 36"
          stroke={GLOW_BLUE}
          strokeWidth="1.4"
          strokeLinecap="round"
        />
      </G>
    );
  }

  if (state === "error") {
    return (
      <G>
        <Path
          d={`M${left - 4} ${y - 2} Q${left} ${y + 4} ${left + 4} ${y - 2}`}
          stroke={GLOW_BLUE}
          strokeWidth="1.8"
          fill="none"
          strokeLinecap="round"
        />
        <Path
          d={`M${right - 4} ${y - 2} Q${right} ${y + 4} ${right + 4} ${y - 2}`}
          stroke={GLOW_BLUE}
          strokeWidth="1.8"
          fill="none"
          strokeLinecap="round"
        />
        <Path
          d="M46 37 Q50 34 54 37"
          stroke={GLOW_BLUE}
          strokeWidth="1.4"
          fill="none"
          strokeLinecap="round"
        />
      </G>
    );
  }

  return (
    <G>
      <Path
        d={`M${left - 4} ${y} Q${left} ${y + 3} ${left + 4} ${y}`}
        stroke="#5E7CB8"
        strokeWidth="1.8"
        fill="none"
        strokeLinecap="round"
      />
      <Path
        d={`M${right - 4} ${y} Q${right} ${y + 3} ${right + 4} ${y}`}
        stroke="#5E7CB8"
        strokeWidth="1.8"
        fill="none"
        strokeLinecap="round"
      />
      <Path
        d="M46 37 L54 37"
        stroke="#5E7CB8"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
    </G>
  );
}

function LevelFx({
  size,
  color,
  level,
}: {
  size: number;
  color: string;
  level: number;
}) {
  if (level < 5) return null;

  return (
    <Svg width={size} height={size} viewBox="0 0 100 100">
      <Ellipse
        cx="50"
        cy="82"
        rx={level >= 10 ? "44" : "36"}
        ry={level >= 10 ? "8" : "6.5"}
        stroke={color}
        strokeOpacity={level >= 10 ? 0.45 : 0.32}
        strokeWidth="1.2"
        fill="none"
      />
      {level >= 10 ? (
        <>
          <Circle cx="12" cy="24" r="1.4" fill={color} opacity="0.7" />
          <Circle cx="88" cy="32" r="1.2" fill={color} opacity="0.7" />
          <Circle cx="84" cy="14" r="0.9" fill={color} opacity="0.55" />
        </>
      ) : null}
    </Svg>
  );
}

function AwayBadge({ size, color }: { size: number; color: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 100 100">
      <Circle cx="78" cy="22" r="5.5" fill={BUTLER_SHEET.screen} opacity="0.82" />
      <Circle cx="76" cy="22" r="1" fill={color} opacity="0.55" />
      <Circle cx="79" cy="22" r="1" fill={color} opacity="0.55" />
      <Circle cx="82" cy="22" r="1" fill={color} opacity="0.55" />
    </Svg>
  );
}

const styles = StyleSheet.create({
  frame: {
    position: "relative",
    alignItems: "center",
    justifyContent: "center",
  },
});
