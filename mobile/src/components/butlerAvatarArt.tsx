// Alfred robot mascot — react-native-svg port of the 3D mascot reference.
// Public API: ButlerSvg (Today / Ask / Capture) and CloudHomeSvg (center tab slot).

import { useEffect, useId, useRef, useState } from "react";
import { Animated, Easing } from "react-native";
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

/** Mascot palette — white body, black screen, blue accents, pink blush. */
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
  const uid = useId().replace(/:/g, "");
  const eyeGrad = `eye-${uid}`;
  const height = Math.round(size * 1.07);
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
      <Svg width={size} height={height} viewBox="0 0 240 256">
        <RobotBody color={color} level={level} state={state} eyeGrad={eyeGrad} />
      </Svg>
    </Animated.View>
  );
}

/** Cloud cottage — center tab slot; robot peeks out when occupied. */
export function CloudHomeSvg({
  size,
  color,
  occupied,
  state,
}: CloudHomeSvgProps) {
  const uid = useId().replace(/:/g, "");
  const glowGrad = `hglow-${uid}`;
  const eyeGrad = `heye-${uid}`;

  const hover = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(hover, {
          toValue: -3,
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
      <Svg width={size} height={size} viewBox="0 0 120 104">
        <Defs>
          <RadialGradient id={glowGrad} cx="0.5" cy="0.6" r="0.8">
            <Stop offset="0" stopColor={color} stopOpacity="0.55" />
            <Stop offset="1" stopColor={color} stopOpacity="0.05" />
          </RadialGradient>
          <RadialGradient id={eyeGrad} cx="0.38" cy="0.32" r="0.85">
            <Stop offset="0" stopColor="#D9F2FF" />
            <Stop offset="0.55" stopColor="#8CC0FB" />
            <Stop offset="1" stopColor={color} />
          </RadialGradient>
        </Defs>
        <Ellipse
          cx="60"
          cy="99"
          rx="30"
          ry="4.5"
          fill="#19171A"
          opacity="0.10"
        />
        <G>
          <Line
            x1="90"
            y1="34"
            x2="90"
            y2="12"
            stroke={BUTLER_SHEET.bodyShade}
            strokeWidth="2.5"
            strokeLinecap="round"
          />
          <Path d="M90 12 L106 17 L90 22 Z" fill={color} />
          <Circle
            cx="36"
            cy="62"
            r="22"
            fill={BUTLER_SHEET.white}
            stroke={BUTLER_SHEET.bodyShade}
            strokeWidth="1.5"
          />
          <Circle
            cx="86"
            cy="60"
            r="24"
            fill={BUTLER_SHEET.white}
            stroke={BUTLER_SHEET.bodyShade}
            strokeWidth="1.5"
          />
          <Circle
            cx="60"
            cy="44"
            r="26"
            fill={BUTLER_SHEET.white}
            stroke={BUTLER_SHEET.bodyShade}
            strokeWidth="1.5"
          />
          <Rect
            x="20"
            y="56"
            width="80"
            height="30"
            rx="15"
            fill={BUTLER_SHEET.white}
          />
          <Circle cx="30" cy="66" r="5" fill={BUTLER_SHEET.screen} />
          <Circle cx="30" cy="66" r="2" fill={color} opacity="0.85" />
          <Circle cx="92" cy="66" r="5" fill={BUTLER_SHEET.screen} />
          <Circle cx="92" cy="66" r="2" fill={color} opacity="0.85" />
          {occupied ? (
            <HomeDoorOccupied color={color} state={state} eyeGrad={eyeGrad} />
          ) : (
            <HomeDoorAway color={color} glowGrad={glowGrad} />
          )}
          <Path
            d="M22 86 Q60 92 98 86"
            stroke={BUTLER_SHEET.bodyShade}
            strokeWidth="1.5"
            fill="none"
          />
          {state === "thinking" ? <HomeThinkingBits color={color} /> : null}
        </G>
      </Svg>
    </Animated.View>
  );
}

function HomeDoorAway({
  color,
  glowGrad,
}: {
  color: string;
  glowGrad: string;
}) {
  return (
    <G>
      <Path
        d="M40 86 L40 64 Q60 44 80 64 L80 86 Z"
        fill={BUTLER_SHEET.screen}
      />
      <Ellipse
        cx="60"
        cy="72"
        rx="14"
        ry="12"
        fill={`url(#${glowGrad})`}
      />
      <Circle cx="55" cy="62" r="1.6" fill={color} opacity="0.8" />
      <Circle cx="64" cy="56" r="1.2" fill={color} opacity="0.6" />
      <Circle cx="61" cy="66" r="1" fill="#FFFFFF" opacity="0.7" />
    </G>
  );
}

function HomeDoorOccupied({
  color,
  state,
  eyeGrad,
}: {
  color: string;
  state: AvatarState;
  eyeGrad: string;
}) {
  return (
    <G>
      <Path
        d="M40 86 L40 64 Q60 44 80 64 L80 86 Z"
        fill={BUTLER_SHEET.screen}
      />
      {/* Robot head peeking out */}
      <Circle
        cx="60"
        cy="48"
        r="14"
        fill={BUTLER_SHEET.white}
        stroke={BUTLER_SHEET.bodyShade}
        strokeWidth="1"
      />
      <Line
        x1="60"
        y1="36"
        x2="60"
        y2="30"
        stroke={BUTLER_SHEET.antenna}
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <Path
        d="M60 28 C58 26 62 24 60 22 C58 24 62 26 60 28 Z"
        fill={color}
      />
      <Rect
        x="50"
        y="44"
        width="20"
        height="14"
        rx="5"
        fill={BUTLER_SHEET.screen}
      />
      <PeekEyes state={state} eyeGrad={eyeGrad} />
      <Path
        d="M54 58 Q60 62 66 58 L64 56 L56 56 Z"
        fill={color}
      />
    </G>
  );
}

function PeekEyes({
  state,
  eyeGrad,
}: {
  state: AvatarState;
  eyeGrad: string;
}) {
  if (state === "success") {
    return (
      <G>
        <Path
          d="M52 50 Q55 47 58 50"
          stroke={GLOW_BLUE}
          strokeWidth="2"
          fill="none"
          strokeLinecap="round"
        />
        <Path
          d="M62 50 Q65 47 68 50"
          stroke={GLOW_BLUE}
          strokeWidth="2"
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
          d="M52 50 Q55 52 58 50"
          stroke="#5E7CB8"
          strokeWidth="2"
          fill="none"
          strokeLinecap="round"
        />
        <Path
          d="M62 50 Q65 52 68 50"
          stroke="#5E7CB8"
          strokeWidth="2"
          fill="none"
          strokeLinecap="round"
        />
      </G>
    );
  }
  if (state === "thinking") {
    return (
      <G>
        <Circle cx="54" cy="49" r="3" fill={`url(#${eyeGrad})`} />
        <Circle cx="66" cy="49" r="3" fill={`url(#${eyeGrad})`} />
      </G>
    );
  }
  return (
    <G>
      <Circle cx="55" cy="50" r="3" fill={`url(#${eyeGrad})`} />
      <Circle cx="65" cy="50" r="3" fill={`url(#${eyeGrad})`} />
    </G>
  );
}

function RobotBody({
  color,
  level,
  state,
  eyeGrad,
}: {
  color: string;
  level: number;
  state: AvatarState;
  eyeGrad: string;
}) {
  return (
    <>
      <Defs>
        <RadialGradient id={eyeGrad} cx="0.38" cy="0.32" r="0.85">
          <Stop offset="0" stopColor="#D9F2FF" />
          <Stop offset="0.55" stopColor="#8CC0FB" />
          <Stop offset="1" stopColor={color} />
        </RadialGradient>
      </Defs>
      <Ellipse
        cx="120"
        cy="246"
        rx="44"
        ry="8"
        fill="#19171A"
        opacity="0.10"
      />
      <G>
        {level >= 5 ? (
          <Ellipse
            cx="120"
            cy="208"
            rx="78"
            ry="13"
            stroke={color}
            strokeOpacity="0.32"
            strokeWidth="2.5"
            fill="none"
          />
        ) : null}
        {level >= 10 ? (
          <>
            <Ellipse
              cx="120"
              cy="208"
              rx="94"
              ry="18"
              stroke={color}
              strokeOpacity="0.45"
              strokeWidth="2"
              fill="none"
            />
            <Circle cx="36" cy="64" r="3" fill={color} opacity="0.7" />
            <Circle cx="208" cy="88" r="2.6" fill={color} opacity="0.7" />
            <Circle cx="198" cy="40" r="2" fill={color} opacity="0.55" />
          </>
        ) : null}

        {/* Legs */}
        <Ellipse
          cx="102"
          cy="222"
          rx="14"
          ry="10"
          fill={BUTLER_SHEET.white}
          stroke={BUTLER_SHEET.bodyShade}
          strokeWidth="1.5"
        />
        <Ellipse
          cx="138"
          cy="222"
          rx="14"
          ry="10"
          fill={BUTLER_SHEET.white}
          stroke={BUTLER_SHEET.bodyShade}
          strokeWidth="1.5"
        />

        {/* Arms */}
        <Ellipse
          cx="68"
          cy="178"
          rx="12"
          ry="18"
          fill={BUTLER_SHEET.white}
          stroke={BUTLER_SHEET.bodyShade}
          strokeWidth="1.5"
        />
        <Ellipse
          cx="172"
          cy="178"
          rx="12"
          ry="18"
          fill={BUTLER_SHEET.white}
          stroke={BUTLER_SHEET.bodyShade}
          strokeWidth="1.5"
        />

        {/* Torso */}
        <Rect
          x="86"
          y="148"
          width="68"
          height="58"
          rx="28"
          fill={BUTLER_SHEET.white}
          stroke={BUTLER_SHEET.bodyShade}
          strokeWidth="1.5"
        />
        <Path
          d="M92 168 Q120 176 148 168"
          stroke={BUTLER_SHEET.bodyShade}
          strokeWidth="1"
          fill="none"
          opacity="0.5"
        />

        {/* Bow tie */}
        <Path
          d="M104 148 Q96 142 88 148 Q96 154 104 148 Z"
          fill={color}
        />
        <Path
          d="M136 148 Q144 142 152 148 Q144 154 136 148 Z"
          fill={color}
        />
        <Circle cx="120" cy="148" r="5" fill={color} />
        <Rect
          x="117"
          y="145"
          width="6"
          height="6"
          rx="2"
          fill="#FFFFFF"
          opacity="0.25"
        />

        {/* Head */}
        <Circle
          cx="120"
          cy="88"
          r="58"
          fill={BUTLER_SHEET.white}
          stroke={BUTLER_SHEET.bodyShade}
          strokeWidth="1.5"
        />
        <Ellipse
          cx="98"
          cy="72"
          rx="18"
          ry="12"
          fill="#FFFFFF"
          opacity="0.35"
        />

        {/* Antenna + heart */}
        <Line
          x1="120"
          y1="32"
          x2="120"
          y2="10"
          stroke={BUTLER_SHEET.antenna}
          strokeWidth="3"
          strokeLinecap="round"
        />
        <Path
          d="M120 8 C117 4 112 6 112 10 C112 14 120 18 120 18 C120 18 128 14 128 10 C128 6 123 4 120 8 Z"
          fill={color}
        />

        {/* Face screen */}
        <Rect
          x="72"
          y="68"
          width="96"
          height="72"
          rx="18"
          fill={BUTLER_SHEET.screen}
        />
        <Ellipse
          cx="120"
          cy="78"
          rx="32"
          ry="8"
          fill="#FFFFFF"
          opacity="0.06"
        />

        <RobotFace state={state} color={color} eyeGrad={eyeGrad} />

        {state === "thinking" ? <ThinkingBits color={color} /> : null}
        {state === "success" ? <ApprovedCheck /> : null}
        {state === "error" ? (
          <Path
            d="M176 76 q7 12 0 17 q-7 -5 0 -17"
            fill="#BFE6FF"
            opacity="0.9"
          />
        ) : null}
        {state === "sleep" ? (
          <SvgText
            x="184"
            y="44"
            fontSize="17"
            fill={color}
            opacity="0.65"
            fontStyle="italic"
          >
            z z Z
          </SvgText>
        ) : null}
      </G>
    </>
  );
}

function BlushMarks({ show }: { show: boolean }) {
  if (!show) return null;
  return (
    <G opacity="0.85">
      <Line
        x1="78"
        y1="108"
        x2="84"
        y2="114"
        stroke={BUTLER_SHEET.blush}
        strokeWidth="2.5"
        strokeLinecap="round"
      />
      <Line
        x1="82"
        y1="106"
        x2="88"
        y2="112"
        stroke={BUTLER_SHEET.blush}
        strokeWidth="2.5"
        strokeLinecap="round"
      />
      <Line
        x1="86"
        y1="104"
        x2="92"
        y2="110"
        stroke={BUTLER_SHEET.blush}
        strokeWidth="2.5"
        strokeLinecap="round"
      />
      <Line
        x1="148"
        y1="108"
        x2="154"
        y2="114"
        stroke={BUTLER_SHEET.blush}
        strokeWidth="2.5"
        strokeLinecap="round"
      />
      <Line
        x1="152"
        y1="106"
        x2="158"
        y2="112"
        stroke={BUTLER_SHEET.blush}
        strokeWidth="2.5"
        strokeLinecap="round"
      />
      <Line
        x1="156"
        y1="104"
        x2="162"
        y2="110"
        stroke={BUTLER_SHEET.blush}
        strokeWidth="2.5"
        strokeLinecap="round"
      />
    </G>
  );
}

function GlowEye({
  cx,
  cy,
  r,
  color,
  eyeGrad,
}: {
  cx: number;
  cy: number;
  r: number;
  color: string;
  eyeGrad: string;
}) {
  return (
    <G>
      <Ellipse
        cx={cx}
        cy={cy}
        rx={r + 5}
        ry={r + 5}
        fill={color}
        opacity="0.22"
      />
      <Circle cx={cx} cy={cy} r={r} fill={`url(#${eyeGrad})`} />
      <Circle
        cx={cx - r * 0.28}
        cy={cy - r * 0.32}
        r={r * 0.24}
        fill="#FFFFFF"
        opacity="0.75"
      />
    </G>
  );
}

function RobotFace({
  state,
  color,
  eyeGrad,
}: {
  state: AvatarState;
  color: string;
  eyeGrad: string;
}) {
  const [blink, setBlink] = useState(false);

  useEffect(() => {
    if (state !== "idle") {
      setBlink(false);
      return;
    }
    const id = setInterval(() => {
      setBlink(true);
      setTimeout(() => setBlink(false), 120);
    }, 3200);
    return () => clearInterval(id);
  }, [state]);

  if (blink && state === "idle") {
    return (
      <G>
        <Line
          x1="88"
          y1="98"
          x2="108"
          y2="98"
          stroke={color}
          strokeWidth="3"
          strokeLinecap="round"
        />
        <Line
          x1="132"
          y1="98"
          x2="152"
          y2="98"
          stroke={color}
          strokeWidth="3"
          strokeLinecap="round"
        />
        <Path
          d="M112 118 Q120 124 128 118"
          stroke={color}
          strokeWidth="3"
          fill="none"
          strokeLinecap="round"
        />
      </G>
    );
  }

  switch (state) {
    case "focused":
      return (
        <G>
          <GlowEye cx={98} cy={96} r={9} color={color} eyeGrad={eyeGrad} />
          <GlowEye cx={142} cy={96} r={9} color={color} eyeGrad={eyeGrad} />
          <Line
            x1="86"
            y1="96"
            x2="110"
            y2="96"
            stroke={BUTLER_SHEET.screen}
            strokeWidth="2"
          />
          <Line
            x1="130"
            y1="96"
            x2="154"
            y2="96"
            stroke={BUTLER_SHEET.screen}
            strokeWidth="2"
          />
          <Path
            d="M114 118 L126 118"
            stroke={color}
            strokeWidth="3"
            strokeLinecap="round"
          />
        </G>
      );
    case "thinking":
      return (
        <G>
          <GlowEye cx={96} cy={92} r={10} color={color} eyeGrad={eyeGrad} />
          <GlowEye cx={144} cy={92} r={10} color={color} eyeGrad={eyeGrad} />
          <Path
            d="M112 118 Q120 112 128 118"
            stroke={color}
            strokeWidth="3"
            fill="none"
            strokeLinecap="round"
          />
        </G>
      );
    case "success":
      return (
        <G>
          <Path
            d="M86 100 Q98 86 110 100"
            stroke={GLOW_BLUE}
            strokeWidth="6"
            fill="none"
            strokeLinecap="round"
          />
          <Path
            d="M130 100 Q142 86 154 100"
            stroke={GLOW_BLUE}
            strokeWidth="6"
            fill="none"
            strokeLinecap="round"
          />
          <Path
            d="M108 122 Q120 132 132 122"
            stroke={color}
            strokeWidth="4"
            fill="none"
            strokeLinecap="round"
          />
          <BlushMarks show />
        </G>
      );
    case "error":
      return (
        <G>
          <Path
            d="M86 94 Q98 106 110 94"
            stroke={GLOW_BLUE}
            strokeWidth="5"
            fill="none"
            strokeLinecap="round"
          />
          <Path
            d="M130 94 Q142 106 154 94"
            stroke={GLOW_BLUE}
            strokeWidth="5"
            fill="none"
            strokeLinecap="round"
          />
          <Path
            d="M112 122 Q120 116 128 122"
            stroke={color}
            strokeWidth="3"
            fill="none"
            strokeLinecap="round"
          />
        </G>
      );
    case "sleep":
      return (
        <G>
          <Path
            d="M88 98 Q98 106 108 98"
            stroke="#5E7CB8"
            strokeWidth="4.5"
            fill="none"
            strokeLinecap="round"
          />
          <Path
            d="M132 98 Q142 106 152 98"
            stroke="#5E7CB8"
            strokeWidth="4.5"
            fill="none"
            strokeLinecap="round"
          />
          <Path
            d="M114 120 L126 120"
            stroke="#5E7CB8"
            strokeWidth="3"
            strokeLinecap="round"
          />
        </G>
      );
    default:
      return (
        <G>
          <GlowEye cx={98} cy={98} r={10} color={color} eyeGrad={eyeGrad} />
          <GlowEye cx={142} cy={98} r={10} color={color} eyeGrad={eyeGrad} />
          <Path
            d="M110 120 Q120 126 130 120"
            stroke={color}
            strokeWidth="3.5"
            fill="none"
            strokeLinecap="round"
          />
          <BlushMarks show />
        </G>
      );
  }
}

function HomeThinkingBits({ color }: { color: string }) {
  return (
    <G>
      <Path
        d="M78 18 L74 8"
        stroke={color}
        strokeWidth="2.5"
        strokeLinecap="round"
      />
      <Path
        d="M88 14 L88 6"
        stroke={color}
        strokeWidth="2.5"
        strokeLinecap="round"
      />
      <Path
        d="M98 18 L102 8"
        stroke={color}
        strokeWidth="2.5"
        strokeLinecap="round"
      />
    </G>
  );
}

function ThinkingBits({ color }: { color: string }) {
  return (
    <G>
      <Path
        d="M168 34 L160 16"
        stroke={color}
        strokeWidth="4"
        strokeLinecap="round"
      />
      <Path
        d="M182 38 L182 20"
        stroke={color}
        strokeWidth="4"
        strokeLinecap="round"
      />
      <Path
        d="M195 46 L204 30"
        stroke={color}
        strokeWidth="4"
        strokeLinecap="round"
      />
      <Circle
        cx="120"
        cy="130"
        r="114"
        stroke={color}
        strokeWidth="2"
        strokeDasharray="3 9"
        strokeOpacity="0.3"
        fill="none"
      />
    </G>
  );
}

function ApprovedCheck() {
  return (
    <G>
      <Circle cx="192" cy="52" r="15" fill="#34B87C" />
      <Path
        d="M185 52 L190 58 L200 45"
        stroke="#FFFFFF"
        strokeWidth="3.6"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </G>
  );
}
