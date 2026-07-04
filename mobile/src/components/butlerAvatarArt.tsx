// Alfred robot mascot — react-native-svg port of the 3D reference character.
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

/** Robot mascot palette — matched to docs/assets/alfred-mascot-reference.png */
export const BUTLER_SHEET = {
  body: "#FAFAFA",
  bodyStroke: "#E4E4E4",
  face: "#141414",
  sky: "#4787F7",
  glow: "#BFE0FF",
  blush: "#FFB8CC",
  cream: "#F9F4E8",
  navy: "#0B102D",
} as const;

const ARC_EYE = BUTLER_SHEET.glow;

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

/** Full robot character — Today header, Ask dock, Capture hero (160px). */
export function ButlerSvg({ size, color, level, state }: ButlerSvgProps) {
  const uid = useId().replace(/:/g, "");
  const eyeGrad = `eye-${uid}`;
  const height = Math.round(size * 1.12);
  const dim = state === "sleep" ? 0.85 : 1;
  const showDetails = size >= 120;

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
      <Svg width={size} height={height} viewBox="0 0 240 270">
        <RobotBody
          color={color}
          level={level}
          state={state}
          eyeGrad={eyeGrad}
          showDetails={showDetails}
        />
      </Svg>
    </Animated.View>
  );
}

/** Compact robot bust for the center tab — replaces the cloud cottage. */
export function CloudHomeSvg({
  size,
  color,
  occupied,
  state,
}: CloudHomeSvgProps) {
  const uid = useId().replace(/:/g, "");
  const eyeGrad = `heye-${uid}`;
  const glowGrad = `hglow-${uid}`;

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
      <Svg width={size} height={size} viewBox="0 0 120 120">
        <Defs>
          <RadialGradient id={glowGrad} cx="0.5" cy="0.55" r="0.75">
            <Stop offset="0" stopColor={color} stopOpacity="0.35" />
            <Stop offset="1" stopColor={color} stopOpacity="0.02" />
          </RadialGradient>
          <RadialGradient id={eyeGrad} cx="0.38" cy="0.32" r="0.85">
            <Stop offset="0" stopColor="#D9F2FF" />
            <Stop offset="0.55" stopColor="#8CC0FB" />
            <Stop offset="1" stopColor={BUTLER_SHEET.sky} />
          </RadialGradient>
        </Defs>
        <Ellipse cx="60" cy="112" rx="28" ry="4" fill="#19171A" opacity="0.10" />
        <G>
          {!occupied ? (
            <Ellipse cx="60" cy="68" rx="38" ry="38" fill={`url(#${glowGrad})`} />
          ) : null}
          <HeartAntenna cx={60} cy={18} color={color} scale={0.55} />
          <Circle
            cx="60"
            cy="58"
            r="34"
            fill={BUTLER_SHEET.body}
            stroke={BUTLER_SHEET.bodyStroke}
            strokeWidth="1.5"
          />
          <Rect
            x="36"
            y="46"
            width="48"
            height="32"
            rx="14"
            fill={occupied ? BUTLER_SHEET.face : BUTLER_SHEET.navy}
            opacity={occupied ? 1 : 0.85}
          />
          {occupied ? (
            <>
              <RobotEyes
                state={state}
                eyeGrad={eyeGrad}
                leftCx={46}
                rightCx={74}
                cy={62}
                scale={0.42}
              />
              <BlushCheeks leftX={38} rightX={68} cy={72} scale={0.38} />
            </>
          ) : (
            <G opacity={0.55}>
              <Circle cx="48" cy="60" r="2.2" fill={color} />
              <Circle cx="72" cy="60" r="2.2" fill={color} />
              <Circle cx="60" cy="68" r="1.6" fill={color} opacity="0.7" />
            </G>
          )}
          <BowTie cx={60} cy={88} color={color} scale={0.55} />
          {state === "thinking" ? <HomeThinkingBits color={color} /> : null}
        </G>
      </Svg>
    </Animated.View>
  );
}

function HeartAntenna({
  cx,
  cy,
  color,
  scale = 1,
}: {
  cx: number;
  cy: number;
  color: string;
  scale?: number;
}) {
  const s = scale;
  return (
    <G>
      <Line
        x1={cx}
        y1={cy + 8 * s}
        x2={cx}
        y2={cy + 22 * s}
        stroke={BUTLER_SHEET.face}
        strokeWidth={2.2 * s}
        strokeLinecap="round"
      />
      <Path
        d={`M ${cx} ${cy + 6 * s} C ${cx - 5 * s} ${cy - 2 * s}, ${cx - 9 * s} ${cy + 4 * s}, ${cx} ${cy + 10 * s} C ${cx + 9 * s} ${cy + 4 * s}, ${cx + 5 * s} ${cy - 2 * s}, ${cx} ${cy + 6 * s} Z`}
        fill={color}
      />
    </G>
  );
}

function BowTie({
  cx,
  cy,
  color,
  scale = 1,
}: {
  cx: number;
  cy: number;
  color: string;
  scale?: number;
}) {
  const s = scale;
  return (
    <G>
      <Path
        d={`M ${cx - 14 * s} ${cy} Q ${cx - 18 * s} ${cy - 6 * s} ${cx - 8 * s} ${cy - 4 * s} L ${cx} ${cy} L ${cx - 8 * s} ${cy + 4 * s} Q ${cx - 18 * s} ${cy + 6 * s} ${cx - 14 * s} ${cy} Z`}
        fill={color}
      />
      <Path
        d={`M ${cx + 14 * s} ${cy} Q ${cx + 18 * s} ${cy - 6 * s} ${cx + 8 * s} ${cy - 4 * s} L ${cx} ${cy} L ${cx + 8 * s} ${cy + 4 * s} Q ${cx + 18 * s} ${cy + 6 * s} ${cx + 14 * s} ${cy} Z`}
        fill={color}
      />
      <Circle cx={cx} cy={cy} r={3.2 * s} fill={color} />
    </G>
  );
}

function BlushCheeks({
  leftX,
  rightX,
  cy,
  scale = 1,
}: {
  leftX: number;
  rightX: number;
  cy: number;
  scale?: number;
}) {
  const s = scale;
  const stroke = 1.8 * s;
  const lines = (ox: number) =>
    [0, 1, 2].map((i) => (
      <Line
        key={`${ox}-${i}`}
        x1={ox + i * 2.5 * s}
        y1={cy + i * 2 * s}
        x2={ox + (i + 1) * 2.5 * s}
        y2={cy + (i + 1) * 2 * s}
        stroke={BUTLER_SHEET.blush}
        strokeWidth={stroke}
        strokeLinecap="round"
        opacity={0.85}
      />
    ));
  return (
    <G>
      {lines(leftX)}
      {lines(rightX)}
    </G>
  );
}

function RobotBody({
  color,
  level,
  state,
  eyeGrad,
  showDetails,
}: {
  color: string;
  level: number;
  state: AvatarState;
  eyeGrad: string;
  showDetails: boolean;
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
      <Ellipse cx="120" cy="258" rx="52" ry="8" fill="#19171A" opacity="0.10" />

      {level >= 5 ? (
        <Ellipse
          cx="120"
          cy="210"
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
            cy="210"
            rx="94"
            ry="18"
            stroke={color}
            strokeOpacity="0.45"
            strokeWidth="2"
            fill="none"
          />
          <Circle cx="36" cy="64" r="3" fill={color} opacity="0.7" />
          <Circle cx="208" cy="88" r="2.6" fill={color} opacity="0.7" />
        </>
      ) : null}

      {showDetails ? (
        <G>
          <Rect
            x="148"
            y="188"
            width="52"
            height="38"
            rx="6"
            fill={color}
          />
          <Rect
            x="152"
            y="192"
            width="44"
            height="30"
            rx="4"
            fill={BUTLER_SHEET.cream}
          />
          <Path
            d="M160 206 L160 198 L168 202 Z"
            fill={color}
            opacity="0.35"
          />
          <Path
            d="M132 200 L148 188 L152 192 L136 204 Z"
            fill={BUTLER_SHEET.body}
            stroke={BUTLER_SHEET.bodyStroke}
            strokeWidth="1.2"
          />
          <Line
            x1="144"
            y1="196"
            x2="154"
            y2="186"
            stroke={BUTLER_SHEET.face}
            strokeWidth="2.5"
            strokeLinecap="round"
          />
          <Path
            d="M178 72 C178 62 188 58 196 64 C204 70 202 82 192 86 C186 72 182 68 178 72 Z"
            fill={color}
            opacity="0.92"
          />
          <Path
            d="M186 68 C190 64 194 66 196 72 C194 76 188 76 186 68 Z"
            fill="#FFFFFF"
            opacity="0.85"
          />
        </G>
      ) : null}

      <Ellipse
        cx="68"
        cy="218"
        rx="14"
        ry="18"
        fill={BUTLER_SHEET.body}
        stroke={BUTLER_SHEET.bodyStroke}
        strokeWidth="1.5"
      />
      <Ellipse
        cx="172"
        cy="218"
        rx="14"
        ry="18"
        fill={BUTLER_SHEET.body}
        stroke={BUTLER_SHEET.bodyStroke}
        strokeWidth="1.5"
      />

      <Rect
        x="72"
        y="168"
        width="96"
        height="78"
        rx="32"
        fill={BUTLER_SHEET.body}
        stroke={BUTLER_SHEET.bodyStroke}
        strokeWidth="1.5"
      />

      <HeartAntenna cx={120} cy={28} color={color} scale={1} />

      <Circle
        cx="120"
        cy="108"
        r="58"
        fill={BUTLER_SHEET.body}
        stroke={BUTLER_SHEET.bodyStroke}
        strokeWidth="1.5"
      />

      <Rect
        x="68"
        y="88"
        width="104"
        height="58"
        rx="26"
        fill={BUTLER_SHEET.face}
      />
      <Ellipse cx="96" cy="98" rx="22" ry="8" fill="#FFFFFF" opacity="0.08" />

      <RobotEyes
        state={state}
        eyeGrad={eyeGrad}
        leftCx={92}
        rightCx={148}
        cy={112}
        scale={1}
      />
      <BlushCheeks leftX={78} rightX={152} cy={132} scale={1} />
      <BowTie cx={120} cy={162} color={color} scale={1} />

      {state === "thinking" ? <ThinkingBits color={color} /> : null}
      {state === "success" ? <ApprovedCheck /> : null}
      {state === "error" ? (
        <Path
          d="M176 76 q7 12 0 17 q-7 -5 0 -17"
          fill={BUTLER_SHEET.glow}
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
    </>
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
        rx={r + 5}
        ry={r + 5}
        fill={BUTLER_SHEET.sky}
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

function RobotEyes({
  state,
  eyeGrad,
  leftCx,
  rightCx,
  cy,
  scale,
}: {
  state: AvatarState;
  eyeGrad: string;
  leftCx: number;
  rightCx: number;
  cy: number;
  scale: number;
}) {
  const [blink, setBlink] = useState(false);
  const sw = 5.5 * scale;
  const r = 10 * scale;

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
          x1={leftCx - 12 * scale}
          y1={cy}
          x2={leftCx + 12 * scale}
          y2={cy}
          stroke={ARC_EYE}
          strokeWidth={sw}
          strokeLinecap="round"
        />
        <Line
          x1={rightCx - 12 * scale}
          y1={cy}
          x2={rightCx + 12 * scale}
          y2={cy}
          stroke={ARC_EYE}
          strokeWidth={sw}
          strokeLinecap="round"
        />
      </G>
    );
  }

  const arc = (cx: number, d: string) => (
    <Path
      d={d}
      stroke={ARC_EYE}
      strokeWidth={sw + 1}
      fill="none"
      strokeLinecap="round"
    />
  );

  switch (state) {
    case "focused":
      return (
        <G>
          <GlossyEye cx={leftCx} cy={cy - 2 * scale} r={r - 1} eyeGrad={eyeGrad} />
          <GlossyEye cx={rightCx} cy={cy - 2 * scale} r={r - 1} eyeGrad={eyeGrad} />
          <Line
            x1={leftCx - 14 * scale}
            y1={cy - 4 * scale}
            x2={leftCx + 14 * scale}
            y2={cy - 4 * scale}
            stroke={BUTLER_SHEET.face}
            strokeWidth={2.5 * scale}
          />
          <Line
            x1={rightCx - 14 * scale}
            y1={cy - 4 * scale}
            x2={rightCx + 14 * scale}
            y2={cy - 4 * scale}
            stroke={BUTLER_SHEET.face}
            strokeWidth={2.5 * scale}
          />
        </G>
      );
    case "thinking":
      return (
        <G>
          <GlossyEye cx={leftCx} cy={cy - 3 * scale} r={r - 1} eyeGrad={eyeGrad} />
          <GlossyEye cx={rightCx} cy={cy - 3 * scale} r={r - 1} eyeGrad={eyeGrad} />
        </G>
      );
    case "success":
      return (
        <G>
          {arc(
            leftCx,
            `M ${leftCx - 14 * scale} ${cy + 2 * scale} Q ${leftCx} ${cy - 12 * scale} ${leftCx + 14 * scale} ${cy + 2 * scale}`,
          )}
          {arc(
            rightCx,
            `M ${rightCx - 14 * scale} ${cy + 2 * scale} Q ${rightCx} ${cy - 12 * scale} ${rightCx + 14 * scale} ${cy + 2 * scale}`,
          )}
          <Path
            d={`M ${rightCx + 18 * scale} ${cy - 18 * scale} Q ${rightCx + 28 * scale} ${cy - 28 * scale} ${rightCx + 36 * scale} ${cy - 16 * scale}`}
            stroke={ARC_EYE}
            strokeWidth={3 * scale}
            fill="none"
            strokeLinecap="round"
            opacity="0.7"
          />
        </G>
      );
    case "error":
      return (
        <G>
          {arc(
            leftCx,
            `M ${leftCx - 14 * scale} ${cy - 6 * scale} Q ${leftCx} ${cy + 8 * scale} ${leftCx + 14 * scale} ${cy - 6 * scale}`,
          )}
          {arc(
            rightCx,
            `M ${rightCx - 14 * scale} ${cy - 6 * scale} Q ${rightCx} ${cy + 8 * scale} ${rightCx + 14 * scale} ${cy - 6 * scale}`,
          )}
        </G>
      );
    case "sleep":
      return (
        <G>
          {arc(
            leftCx,
            `M ${leftCx - 12 * scale} ${cy + 2 * scale} Q ${leftCx} ${cy + 10 * scale} ${leftCx + 12 * scale} ${cy + 2 * scale}`,
          )}
          {arc(
            rightCx,
            `M ${rightCx - 12 * scale} ${cy + 2 * scale} Q ${rightCx} ${cy + 10 * scale} ${rightCx + 12 * scale} ${cy + 2 * scale}`,
          )}
        </G>
      );
    default:
      return (
        <G>
          <GlossyEye cx={leftCx} cy={cy} r={r} eyeGrad={eyeGrad} />
          <GlossyEye cx={rightCx} cy={cy} r={r} eyeGrad={eyeGrad} />
        </G>
      );
  }
}

function HomeThinkingBits({ color }: { color: string }) {
  return (
    <G>
      <Path d="M78 18 L74 8" stroke={color} strokeWidth="2.5" strokeLinecap="round" />
      <Path d="M88 14 L88 6" stroke={color} strokeWidth="2.5" strokeLinecap="round" />
      <Path d="M98 18 L102 8" stroke={color} strokeWidth="2.5" strokeLinecap="round" />
    </G>
  );
}

function ThinkingBits({ color }: { color: string }) {
  return (
    <G>
      <Path d="M168 34 L160 16" stroke={color} strokeWidth="4" strokeLinecap="round" />
      <Path d="M182 38 L182 20" stroke={color} strokeWidth="4" strokeLinecap="round" />
      <Path d="M195 46 L204 30" stroke={color} strokeWidth="4" strokeLinecap="round" />
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
