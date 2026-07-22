// Alfred UI System tokens — warm cream paper (alfred-ui-system/src/styles.css).
// Display: Noto Serif SC. Brand italic: Georgia. Body: DM Sans.

import { Platform } from "react-native";
import type { Priority } from "@albert/shared-types";

export const colors = {
  // CSS :root
  navy950: "#07142C",
  navy900: "#0B1D3F",
  navy800: "#17335E",
  blue700: "#2F66C8",
  blue600: "#3F74D8",
  blue500: "#5A8DF4",
  blue100: "#EAF1FF",
  blue50: "#F4F7FF",
  textPrimary: "#0D1D3B",
  textSecondary: "#7B7B77",
  textTertiary: "#8A867F",
  background: "#F8F5EF",
  surface: "#FFFDF9",
  border: "rgba(157,147,127,0.13)",

  // Surfaces — warm cream paper
  paper: "#F8F5EF",
  paper2: "#F5F2EC",
  paper3: "#ECE8DF",
  card: "#FFFDF9",
  glass: "rgba(255,253,249,0.94)",
  glassSoft: "rgba(255,250,244,0.88)",

  // Full-screen wash (body gradient)
  washTop: "#F5F2EC",
  washMid: "#F2EFE8",
  washBottom: "#ECE8DF",
  washVignette: "rgba(50,47,40,0.04)",
  heroWash: "#F8F5EF",

  // Soft orbs
  orbOne: "rgba(255,255,255,0.55)",
  orbTwo: "rgba(47,102,200,0.06)",

  // Ink hierarchy
  ink: "#0D1D3B",
  ink2: "#0B1D3F",
  ink3: "#77756F",
  ink4: "#8A867F",

  // Hairlines — warm taupe
  hair: "rgba(157,147,127,0.13)",
  hair2: "rgba(130,120,100,0.14)",
  hairLight: "rgba(255,255,255,0.95)",
  line: "#E8E2D8",

  // Accent blue
  accent: "#2F66C8",
  accentBright: "#3F74D8",
  accentDeep: "#245ACB",
  accentSoft: "#EAF1FF",
  accentInk: "#17376D",
  accentWell: "#E8F0FF",

  // Icon tile tones
  toneBlue: "#2F66C8",
  tonePurple: "#625AE6",
  toneGreen: "#36A565",
  toneYellow: "#D49B1C",
  toneNeutral: "#5D6471",

  // Primary CTA (cream gradient button in design system)
  primaryFrom: "#F6F2EC",
  primaryTo: "#E8E1D8",
  primaryInk: "#26446F",
  successFrom: "#299675",
  successTo: "#167458",

  warn: "#A84A36",
  warnSoft: "#F0DDD2",
  success: "#3B9A61",
  successSoft: "#E8F7EE",
} as const;

export const layout = {
  padX: 18,
  gapCard: 14,
  gapSection: 20,
  cardPad: 14,
  topPad: 12,
  // Edge-to-edge bottom nav (76) + elevated center avatar clearance.
  tabBarInset: 96,
} as const;

// Font family keys must match names registered in app/_layout.tsx useFonts().
export const fonts = {
  serif: "NotoSerifSC_500Medium",
  serifDisplay: "NotoSerifSC_600SemiBold",
  /** @deprecated Prefer brandItalic for name emphasis. */
  serifItalic: "NotoSerifSC_500Medium",
  brand: Platform.select({ ios: "Georgia", android: "serif", default: "Georgia" })!,
  brandItalic: Platform.select({ ios: "Georgia", android: "serif", default: "Georgia" })!,
  mono: "IBMPlexMono_400Regular",
  monoMedium: "IBMPlexMono_500Medium",
  sans: "DMSans_400Regular",
  sansMedium: "DMSans_500Medium",
  sansSemibold: "DMSans_600SemiBold",
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 22,
  xl: 32,
} as const;

export const radius = {
  card: 20,
  focus: 22,
  pill: 100,
  full: 9999,
  sm: 12,
  nav: 0,
} as const;

export const priorityColor: Record<Priority, string> = {
  critical: "#A84A36",
  high: "#C06A3A",
  medium: "#2F66C8",
  low: "#8A867F",
  noise: "#8A867F",
};
