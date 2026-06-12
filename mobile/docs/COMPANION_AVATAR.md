# Companion avatar — product brief

## The brief (the paragraph the review asked for)

Alfred's core value is invisible: it reads, ranks, drafts, and watches threads
in the background, and a user who never *feels* that work churns. The companion
avatar makes the work visible and the relationship warm — a small cloud-core orb
that lives in the tab shell, "thinks" while Ask is in flight, greets you on
Today, and visibly grows (XP → levels → evolution rings) as Alfred completes
real work for you. The user benefit is twofold: **ambient status** (one glance
says "Alfred is on it") and **earned attachment** — progression and streaks
reward the daily check-in habit that a chief-of-staff product needs to be
useful at all. **Monetization:** the cosmetics system (10 items across 5
equipment slots) is deliberately cosmetic-only — it can never gate function —
which makes it a natural future Pro surface (exclusive forms / auras bundled
with the subscription), but v1 ships with every unlock earnable through use and
nothing for sale. **Onboarding implication: zero.** The avatar needs no setup,
no permission, and no tutorial — it hydrates with level-1 defaults on first
launch, earns its first XP from the user's first Ask message, and is
discoverable rather than instructional. If a user never notices it, nothing in
Alfred works worse.

## Design references

- **Alfred-MVP avatar pack** (`clawbot-image-demo/web`): `evo-core-lv1/5/10.svg`
  (concentric cloud orb, accent glow — the current SVG orb reproduces lv1),
  `state-*.svg` overlays, and `AgentAvatarCard` (breathing pulse timing).
- **Prototype annotations**: "Hi!" greeting chip top-right on Today;
  bottom-right chat dock on Ask; avatar-as-home in the center tab button.
- **Animation plan**: `avatarEvolution.ts` already maps each mood to Lottie
  frame segments (`EVOLUTION_STATES`); when the Lottie pack ships, the SVG orb
  swaps out without touching call sites.

## What ships in this PR vs later

| Now | Later |
|---|---|
| SVG orb with moods, level rings, breathing animation | Lottie animation pack |
| XP / levels / streaks / daily caps (`agentMeta.ts`) | Rendering equipped cosmetics on the orb |
| Cosmetic unlocks into inventory | Growth-hub screen (tap the avatar) |
| Keychain persistence, serialized writes | Server-side sync of meta |
| 42 unit tests incl. both review-bug regressions | Render/E2E tests once Lottie lands |
