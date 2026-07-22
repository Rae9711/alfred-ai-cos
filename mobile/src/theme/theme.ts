// Albert design tokens — calm editorial butler (elevated paper, not AI-brochure).
// Display: Newsreader. Body: DM Sans. Meta: IBM Plex Mono.
// Warm stone paper kept as brand continuity; terracotta reserved for warn only.

import type { Priority } from "@albert/shared-types";

export const colors = {
  // Surfaces — cooler stone parchment (less yellow brochure cream)
  paper: "#F2F0EB",
  paper2: "#E8E5DE",
  paper3: "#DDD9D0",
  card: "#FBFBF8",
  // Subtle hero wash (top of viewport depth without glow)
  heroWash: "#EDEAE3",

  // Ink hierarchy — stronger contrast for focal weight
  ink: "#141316",
  ink2: "#35343A",
  ink3: "#6A686F",
  ink4: "#9C9994",

  // Hairlines
  hair: "rgba(20,19,22,0.08)",
  hair2: "rgba(20,19,22,0.16)",

  // Accent (ink-blue) + soft tints — primary attention color
  accent: "#2F4F8C",
  accentSoft: "#D9DFEB",
  accentInk: "#13233F",

  // Warn only (not a brand accent)
  warn: "#A84A36",
  warnSoft: "#F0DDD2",

  // Success (integration "synced" dot)
  success: "#3F6B43",
} as const;

// Named layout constants from the prototype's density-regular. Screens use these
// so the spacing reads like the spec (padX, gapCard, gapSection, cardPad).
export const layout = {
  padX: 18, // screen horizontal padding (--pad-x)
  gapCard: 12, // gap between stacked cards (--gap-card)
  gapSection: 22, // space above a section title (--gap-section)
  cardPad: 16, // card interior padding (--card-pad)
  topPad: 58, // space above the screen header (status bar + breathing room)
  tabBarInset: 82, // custom bottom tab bar — for KeyboardAvoidingView offset
} as const;

// Font family keys must match the names registered in app/_layout.tsx useFonts().
export const fonts = {
  serif: "Newsreader_500Medium",
  serifItalic: "Newsreader_400Regular_Italic",
  mono: "IBMPlexMono_400Regular",
  monoMedium: "IBMPlexMono_500Medium",
  sans: "DMSans_400Regular",
  sansMedium: "DMSans_500Medium",
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 22,
  xl: 32,
} as const;

export const radius = {
  card: 16,
  pill: 100,
  full: 9999,
  sm: 12,
} as const;

// Priority dot/pill colors. critical/high lean on warn (urgent), the rest on ink/accent.
export const priorityColor: Record<Priority, string> = {
  critical: "#A84A36",
  high: "#C06A3A",
  medium: "#2F4F8C",
  low: "#9C9994",
  noise: "#9C9994",
};
