# Companion avatar simulation (dev playground)

A standalone browser playground for the companion avatar — **not part of the
app build**. It exists so we can iterate on the avatar's look, motion, and
game-feel without booting Expo, the backend, or auth.

## Run it

```bash
# from the repo root
bun build mobile/demo/avatar-sim/sim.ts --outfile mobile/demo/avatar-sim/sim.js --format=iife
python3 -m http.server 4799 --directory mobile/demo/avatar-sim
# open http://localhost:4799/
```

## What it is

- `sim.ts` imports the **real** game logic from `mobile/src/lib`
  (`agentMeta.ts` + `avatarEvolution.ts`, bundled as-is) — XP math, daily
  caps, streak multipliers, level thresholds, cosmetic unlocks, and evolution
  forms behave exactly as on the phone.
- A phone mock mirrors the three avatar placements (Today top-right with the
  "Hi!" bubble, Ask bottom-right dock, home in the center tab slot) and an
  Ask chat flow that triggers thinking → reply → XP, same hooks as
  `AskScreen.tsx`.
- State persists to `localStorage` the same way the app persists to
  SecureStore (merge-over-defaults on load, corrupt-safe).

## The two visual designs inside

Toggle between them in the **Visual** panel:

1. **"Light Airy Butler"** (default) — vectorized by hand from the design
   sheet (`mobile/docs/assets/avatar-design-sheet.png`). Exact palette
   (#4787F7 sky / #0B102D navy / #F1F5FF warm white / #E2EBF0 cool gray),
   goggle eye-mask with glossy gradient eyes, tuxedo + signature bow tie,
   flowing cape, hover float + blink + cape sway. Expression mapping:
   - sheet **Calm** → app `idle` (blink loop)
   - sheet **Focused** → `focused` (half-lidded eyes)
   - sheet **Thinking** → `thinking` (glance + surprise ticks above head)
   - sheet **Happy + Approved** → `success` (^ ^ arcs + green check bubble)
   - `error` / `sleep` are extrapolations in the same language (sad arcs +
     sweat drop / closed lids + zzZ)
2. **Cloud orb** — the old `CompanionAvatar.tsx` placeholder, kept for
   comparison.

Plus **the cloud home**: the center tab slot is no longer a "+" glyph — it's
a floating cloud cottage in the butler's design language (navy arched
doorway, accent pennant flag, portholes). Two states: *away working* (Today /
Ask — doorway glow stays lit) and *home* (Inbox / You — the butler peeks out
of the doorway, expression follows his mood). Tapping it still opens Capture.

## Follow-ups (in rough order)

1. Port the butler + cloud home into `mobile/src/components/CompanionAvatar.tsx`
   with `react-native-svg` (already a dependency; the SVG here is drawn with
   plain paths/clip-paths that map 1:1 to react-native-svg primitives).
   The component's public API (`level` / `color` / `state` / placements)
   does not change — screens are untouched.
2. Commission the Lottie rig for production-quality motion — the full
   designer brief lives in `mobile/docs/AVATAR_LOTTIE_BRIEF.md`.
3. Render equipped cosmetics on the character (anchor points are part of the
   Lottie brief).

## Known limitations

- Flat-vector read of a 3D-rendered design — no subsurface/volumetric
  shading. The Lottie/designer pass is the fix for that.
- `sim.js` is a build artifact, committed so the demo runs without a build
  step; regenerate with the bun command above after editing `sim.ts`.
