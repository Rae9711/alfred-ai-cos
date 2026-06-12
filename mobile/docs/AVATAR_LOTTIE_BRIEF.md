# Lottie designer brief — Alfred companion avatar ("Light Airy Butler")

What to commission from a motion designer to replace the hand-vectorized SVG
butler (see `mobile/demo/avatar-sim/`) with a production animation rig.
Reference design: `mobile/docs/assets/avatar-design-sheet.png`.

## 1. Deliverables checklist

| # | Item | Format |
|---|---|---|
| 1 | Master character animation | **Lottie JSON** (Bodymovin export from After Effects) |
| 2 | Same file as dotLottie | `.lottie` (smaller; optional but nice) |
| 3 | AE source project | `.aep` + any precomps (so we can re-export / edit) |
| 4 | Per-state preview renders | MP4 or GIF per state, for review without code |
| 5 | LottieFiles share link | to smoke-test on real devices before handoff |
| 6 | Evolution form variants | lv1 / lv5 / lv10 — see §4 |
| 7 | Cosmetic anchor map | named null layers or a PNG/PDF with coordinates — see §5 |
| 8 | License | full commercial use, source included, no stock packs with restrictions |

## 2. Animation states (one timeline, labeled segments)

Our code plays **frame segments of a single timeline** (see
`EVOLUTION_STATES` in `mobile/src/lib/avatarEvolution.ts`), so ask for ONE
master timeline with marker-labeled segments, each loop-safe (first frame ==
last frame for loops):

| Segment | Sheet reference | Loop? | Notes |
|---|---|---|---|
| `idle` | Calm | loop | hover float + blink every ~4s, subtle cape sway |
| `focused` | Focused | loop | half-lidded eyes, tighter hover |
| `thinking` | Thinking | loop | glance up-aside, surprise ticks, faster bob |
| `success` | Happy + Approved | one-shot → settle | ^ ^ eyes, bounce, green check pop |
| `error` | (extrapolate) | loop | sad arcs, sweat drop, slight droop |
| `sleep` | (extrapolate) | loop | closed lids, dim, slow breathing, zzZ |
| `levelup` | (new) | one-shot | celebration burst — played on level-up |
| `wave` | (new, optional) | one-shot | greeting for app-open / Today |

Also from the sheet's ACTIONS row, as **optional second-phase segments**:
`sorting_email`, `scheduling`, `presenting_plan`, `approval_done`.

Transitions: each loop should enter cleanly from `idle` within ~10 frames, or
ask for explicit `idle→X` transition segments if the designer prefers.

Frame rate 30fps. Loops ~45–60 frames each (1.5–2s), one-shots ≤ 60 frames.

## 3. Technical constraints (put these in the contract)

- **Vector shape layers only.** No embedded raster images (`assets` array in
  the JSON must contain no `.png`/base64 images) — rasters balloon size and
  scale badly.
- **No AE features Lottie can't export**: no third-party plugins, no
  expressions left live (bake them), no gradients-on-strokes if avoidable,
  effects limited to what Bodymovin supports.
- **Keep mattes/masks minimal** — track mattes are the #1 mobile perf killer.
  Prefer shape-boolean construction over alpha mattes.
- **Budget:** ≤ 200 KB per JSON, ≤ ~60 layers, must hold 60fps on a mid-tier
  Android phone. Have them verify in the LottieFiles mobile preview app.
- Canvas: **square 512×512**, character centered with ~8% safe margin all
  around, transparent background.
- Test render in **lottie-react-native** specifically (not just web) — a few
  features render differently between lottie-web and the native players.

## 4. Theming + evolution (needs designer cooperation to work in code)

- **Runtime tint:** we recolor the accent elements (bow tie, eye glow, ear
  tint, flag) in code via `colorFilters` keypaths. The designer must put every
  accent-colored shape on **dedicated, stably-named layers** — e.g.
  `accent_bowtie`, `accent_eyeglow_l`, `accent_eyeglow_r`, `accent_ear_l`,
  `accent_ear_r`. Naming is the contract; if they rename layers, our keypaths
  break.
- **Evolution forms (lv1 / lv5 / lv10):** our model loads one Lottie skin per
  form (`lottieSkin` in `avatarEvolution.ts`). Two acceptable shapes:
  a) three exported JSONs sharing the same timeline markers, or
  b) one JSON with form layers toggled — we'd then split it ourselves from
  the .aep. Option (a) is simpler for us.
  Visual progression per the game design: lv5 adds an orbit halo + stronger
  glow, lv10 adds a second halo + sparkles (see the sim for the intent).

## 5. Cosmetics anchors (for the unlock system)

The game unlocks cosmetics in 5 slots (`head`, `face`, `back`, `aura`,
`badge` — see `COSMETICS` in `mobile/src/lib/agentMeta.ts`). We overlay them
at runtime, so we need **named null/anchor layers** that track the body
through every animation: `anchor_head`, `anchor_face`, `anchor_back`,
`anchor_aura` (centered), `anchor_badge` (chest). Cosmetic art itself can
come later as separate small Lotties/SVGs pinned to those anchors.

## 6. The cloud home (companion deliverable, small)

Same treatment for the home (center tab button — see the sim): one small
Lottie, two segments: `home_idle` (empty, doorway glow pulsing) and
`home_occupied` (butler peeking, blink). Accent layers named `accent_flag`,
`accent_glow`. Canvas 256×224, ≤ 50 KB.

## 7. Code integration (our side, for reference)

- **Mobile:** `lottie-react-native` (`npx expo install lottie-react-native`,
  works in managed Expo). Play segments from refs using our existing state →
  segment map; recolor via `colorFilters={[{ keypath: "accent_bowtie",
  color: meta.color }]}`.
- **Swap point:** only `CompanionAvatar.tsx` changes (`CloudCoreOrb` →
  `LottieView`); the provider, screens, XP system, and placements are
  untouched — that's by design, see the component header comment.
- **Web/demo:** `lottie-web` renders the same JSON in the sim for review.

## 8. What to send the designer

1. The design sheet (`avatar-design-sheet.png`) — it already defines views,
   palette (#4787F7 / #0B102D / #E2EBF0 / #F1F5FF + mint/lilac optionals),
   expressions, and actions.
2. Screen recordings of the SVG sim (placements + all six moods) as the
   motion reference for timing/feel.
3. Sections 2–6 of this brief as the spec.
4. Acceptance test: we load the JSON in the sim with lottie-web + on a real
   device via lottie-react-native, check every segment, tint keypaths, 60fps,
   and file size before sign-off.
