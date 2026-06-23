// "Light Airy Butler" + cloud cottage — react-native-svg port of mobile/demo/avatar-sim/sim.ts.
// Public API: ButlerSvg (Today / Ask) and CloudHomeSvg (center tab slot).

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

/** Design-sheet palette (exact hexes from the COLOR & MATERIAL row). */
export const BUTLER_SHEET = {
  sky: "#4787F7",
  navy: "#0B102D",
  gray: "#E2EBF0",
  white: "#F1F5FF",
  cape: "#93A5DB",
  capeShade: "#7487C2",
} as const;

const ARC_EYE = "#BFE0FF";

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

/** Full butler character — Today header, Ask dock. */
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
        <ButlerBody color={color} level={level} state={state} eyeGrad={eyeGrad} />
      </Svg>
    </Animated.View>
  );
}

/** Cloud cottage — always in the center tab slot; butler peeks out when occupied. */
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
          duration: 4400,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
        Animated.timing(hover, {
          toValue: 0,
          duration: 4400,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [hover]);

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
            <Stop offset="1" stopColor={BUTLER_SHEET.sky} />
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
            stroke={BUTLER_SHEET.gray}
            strokeWidth="2.5"
            strokeLinecap="round"
          />
          <Path d="M90 12 L106 17 L90 22 Z" fill={color} />
          <Circle
            cx="36"
            cy="62"
            r="22"
            fill={BUTLER_SHEET.white}
            stroke={BUTLER_SHEET.gray}
            strokeWidth="1.5"
          />
          <Circle
            cx="86"
            cy="60"
            r="24"
            fill={BUTLER_SHEET.white}
            stroke={BUTLER_SHEET.gray}
            strokeWidth="1.5"
          />
          <Circle
            cx="60"
            cy="44"
            r="26"
            fill={BUTLER_SHEET.white}
            stroke={BUTLER_SHEET.gray}
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
          <Circle cx="30" cy="66" r="5" fill={BUTLER_SHEET.navy} />
          <Circle cx="30" cy="66" r="2" fill={color} opacity="0.85" />
          <Circle cx="92" cy="66" r="5" fill={BUTLER_SHEET.navy} />
          <Circle cx="92" cy="66" r="2" fill={color} opacity="0.85" />
          {occupied ? (
            <HomeDoorOccupied color={color} state={state} eyeGrad={eyeGrad} />
          ) : (
            <HomeDoorAway color={color} glowGrad={glowGrad} />
          )}
          <Path
            d="M22 86 Q60 92 98 86"
            stroke={BUTLER_SHEET.gray}
            strokeWidth="1.5"
            fill="none"
          />
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
        fill={BUTLER_SHEET.navy}
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
        fill={BUTLER_SHEET.navy}
      />
      <Path
        d="M46 40 Q43 26 55 31 Q58 34 56 40 Z"
        fill={BUTLER_SHEET.white}
        stroke={BUTLER_SHEET.gray}
      />
      <Path
        d="M74 40 Q77 26 65 31 Q62 34 64 40 Z"
        fill={BUTLER_SHEET.white}
        stroke={BUTLER_SHEET.gray}
      />
      <Ellipse
        cx="60"
        cy="66"
        rx="19"
        ry="17"
        fill={BUTLER_SHEET.white}
        stroke={BUTLER_SHEET.gray}
      />
      <Path
        d="M44 62 Q44 52 60 52 Q76 52 76 62 Q76 72 60 72 Q44 72 44 62 Z"
        fill={BUTLER_SHEET.navy}
      />
      <PeekEyes state={state} eyeGrad={eyeGrad} />
      <Path
        d="M53 80 L60 84 L67 80 L64 77 L56 77 Z"
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
          d="M50 64 Q54.5 59.5 59 64"
          stroke={ARC_EYE}
          strokeWidth="2.6"
          fill="none"
          strokeLinecap="round"
        />
        <Path
          d="M61 64 Q65.5 59.5 70 64"
          stroke={ARC_EYE}
          strokeWidth="2.6"
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
          d="M50 63 Q54.5 66 59 63"
          stroke="#5E7CB8"
          strokeWidth="2.4"
          fill="none"
          strokeLinecap="round"
        />
        <Path
          d="M61 63 Q65.5 66 70 63"
          stroke="#5E7CB8"
          strokeWidth="2.4"
          fill="none"
          strokeLinecap="round"
        />
      </G>
    );
  }
  return (
    <G>
      <Circle cx="54.5" cy="63" r="4.6" fill={`url(#${eyeGrad})`} />
      <Circle cx="65.5" cy="63" r="4.6" fill={`url(#${eyeGrad})`} />
      <Circle cx="53" cy="61.5" r="1.3" fill="#FFFFFF" opacity="0.8" />
      <Circle cx="64" cy="61.5" r="1.3" fill="#FFFFFF" opacity="0.8" />
    </G>
  );
}

function ButlerBody({
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
          <Stop offset="1" stopColor={BUTLER_SHEET.sky} />
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
        <Path
          d="M88 150 Q46 178 58 222 Q70 214 80 220 Q90 212 100 218 L100 158 Z"
          fill={BUTLER_SHEET.cape}
        />
        <Path
          d="M152 150 Q194 178 182 222 Q170 214 160 220 Q150 212 140 218 L140 158 Z"
          fill={BUTLER_SHEET.cape}
        />
        <Path
          d="M92 152 Q70 180 76 212 L92 200 Z"
          fill={BUTLER_SHEET.capeShade}
          opacity="0.45"
        />
        <Path
          d="M148 152 Q170 180 164 212 L148 200 Z"
          fill={BUTLER_SHEET.capeShade}
          opacity="0.45"
        />
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
        <Ellipse
          cx="105"
          cy="216"
          rx="11"
          ry="8"
          fill={BUTLER_SHEET.white}
          stroke={BUTLER_SHEET.gray}
        />
        <Ellipse
          cx="135"
          cy="216"
          rx="11"
          ry="8"
          fill={BUTLER_SHEET.white}
          stroke={BUTLER_SHEET.gray}
        />
        <Rect
          x="80"
          y="144"
          width="80"
          height="70"
          rx="26"
          fill={BUTLER_SHEET.navy}
        />
        <Path
          d="M104 144 L136 144 L133 200 Q120 207 107 200 Z"
          fill="#FFFFFF"
        />
        <Path
          d="M104 144 L120 162 L111 170 L101 150 Z"
          fill={BUTLER_SHEET.navy}
          opacity="0.92"
        />
        <Path
          d="M136 144 L120 162 L129 170 L139 150 Z"
          fill={BUTLER_SHEET.navy}
          opacity="0.92"
        />
        <Circle cx="120" cy="176" r="2.6" fill={BUTLER_SHEET.navy} />
        <Circle cx="120" cy="190" r="2.6" fill={BUTLER_SHEET.navy} />
        <Ellipse
          cx="73"
          cy="176"
          rx="11"
          ry="15"
          fill={BUTLER_SHEET.white}
          stroke={BUTLER_SHEET.gray}
        />
        <Ellipse
          cx="167"
          cy="176"
          rx="11"
          ry="15"
          fill={BUTLER_SHEET.white}
          stroke={BUTLER_SHEET.gray}
        />
        <Path
          d="M58 70 Q50 14 96 34 Q106 42 100 62 Z"
          fill={BUTLER_SHEET.white}
          stroke={BUTLER_SHEET.gray}
          strokeWidth="1.5"
        />
        <Path
          d="M182 70 Q190 14 144 34 Q134 42 140 62 Z"
          fill={BUTLER_SHEET.white}
          stroke={BUTLER_SHEET.gray}
          strokeWidth="1.5"
        />
        <Rect
          x="44"
          y="44"
          width="152"
          height="118"
          rx="56"
          fill={BUTLER_SHEET.white}
          stroke={BUTLER_SHEET.gray}
          strokeWidth="1.5"
        />
        <Path
          d="M58 142 Q120 168 182 142 L182 150 Q120 174 58 150 Z"
          fill={BUTLER_SHEET.gray}
          opacity="0.45"
        />
        <Path
          d="M64 104 Q64 74 96 72 L144 72 Q176 74 176 104 Q176 132 142 134 L98 134 Q64 132 64 104 Z"
          fill={BUTLER_SHEET.navy}
        />
        <Ellipse
          cx="96"
          cy="83"
          rx="26"
          ry="9"
          fill="#FFFFFF"
          opacity="0.10"
        />
        <ButlerEyes state={state} eyeGrad={eyeGrad} />
        <Path
          d="M99 148 Q94 159 99 170 L117 162 Q119 159 117 156 Z"
          fill={color}
        />
        <Path
          d="M141 148 Q146 159 141 170 L123 162 Q121 159 123 156 Z"
          fill={color}
        />
        <Rect x="113" y="152" width="14" height="14" rx="5" fill={color} />
        <Rect
          x="113"
          y="152"
          width="14"
          height="6"
          rx="3"
          fill="#FFFFFF"
          opacity="0.25"
        />
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
        fill={BUTLER_SHEET.sky}
        opacity="0.25"
      />
      <Circle cx={cx} cy={cy} r={r} fill={`url(#${eyeGrad})`} />
      <Circle
        cx={cx - r * 0.32}
        cy={cy - r * 0.35}
        r={r * 0.26}
        fill="#FFFFFF"
        opacity="0.75"
      />
    </G>
  );
}

function ButlerEyes({
  state,
  eyeGrad,
}: {
  state: AvatarState;
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
          x1="82"
          y1="103"
          x2="108"
          y2="103"
          stroke={BUTLER_SHEET.navy}
          strokeWidth="3"
        />
        <Line
          x1="132"
          y1="103"
          x2="158"
          y2="103"
          stroke={BUTLER_SHEET.navy}
          strokeWidth="3"
        />
      </G>
    );
  }

  switch (state) {
    case "focused":
      return (
        <G>
          <Path d="M82 100 a13 13 0 0 0 26 0 z" fill={`url(#${eyeGrad})`} />
          <Path d="M132 100 a13 13 0 0 0 26 0 z" fill={`url(#${eyeGrad})`} />
          <Line
            x1="80"
            y1="100"
            x2="110"
            y2="100"
            stroke={BUTLER_SHEET.navy}
            strokeWidth="3"
          />
          <Line
            x1="130"
            y1="100"
            x2="160"
            y2="100"
            stroke={BUTLER_SHEET.navy}
            strokeWidth="3"
          />
        </G>
      );
    case "thinking":
      return (
        <G>
          <GlossyEye cx={101} cy={96} r={11} eyeGrad={eyeGrad} />
          <GlossyEye cx={149} cy={96} r={11} eyeGrad={eyeGrad} />
        </G>
      );
    case "success":
      return (
        <G>
          <Path
            d="M82 109 Q95 94 108 109"
            stroke={ARC_EYE}
            strokeWidth="7.5"
            fill="none"
            strokeLinecap="round"
          />
          <Path
            d="M132 109 Q145 94 158 109"
            stroke={ARC_EYE}
            strokeWidth="7.5"
            fill="none"
            strokeLinecap="round"
          />
        </G>
      );
    case "error":
      return (
        <G>
          <Path
            d="M82 99 Q95 111 108 99"
            stroke={ARC_EYE}
            strokeWidth="6.5"
            fill="none"
            strokeLinecap="round"
          />
          <Path
            d="M132 99 Q145 111 158 99"
            stroke={ARC_EYE}
            strokeWidth="6.5"
            fill="none"
            strokeLinecap="round"
          />
        </G>
      );
    case "sleep":
      return (
        <G>
          <Path
            d="M83 104 Q95 112 107 104"
            stroke="#5E7CB8"
            strokeWidth="5.5"
            fill="none"
            strokeLinecap="round"
          />
          <Path
            d="M133 104 Q145 112 157 104"
            stroke="#5E7CB8"
            strokeWidth="5.5"
            fill="none"
            strokeLinecap="round"
          />
        </G>
      );
    default:
      return (
        <G>
          <GlossyEye cx={95} cy={103} r={13} eyeGrad={eyeGrad} />
          <GlossyEye cx={145} cy={103} r={13} eyeGrad={eyeGrad} />
        </G>
      );
  }
}
