# Feature pack: A–H, June 2026

Eight upgrades that turn Albert from "inbox status" into "act-from-a-push chief
of staff". Every backend feature has tests; every mobile change has a typecheck.

## A. Inline actions on Today

The push deep-link lands on Today, where every priority card already exposes
Act / Snooze / Mark done. New: a real "Not important" button that dismisses
the commitment AND records a negative learning signal (feature G), so future
items from the same sender drift down.

**Code:** `mobile/src/components/PriorityCard.tsx`, `mobile/src/screens/TodayScreen.tsx`.

## B. Smart snooze with wake conditions

Tap Snooze → choose "Tomorrow", "This weekend", "Next week", "In 3 days",
"In a week", or "Until they reply". The server parses the phrase, persists
either `snooze_until` (a date) or `snooze_until_reply` (a boolean watching
the thread), and a scanner re-opens the commitment when the wake fires.

- Backend: `app/services/snooze.py` (parser + actions + scanner),
  `POST /api/v1/commitments/{id}/snooze`.
- Mobile: `src/screens/sheets/SnoozeSheet.tsx`.
- Migration: `b2c3d4e5f6a7_add_smart_snooze.py` (adds `snooze_until` +
  `snooze_until_reply` to commitments).
- Worker: `dispatch_due_briefings`-style hook runs every 30 min via
  `scan_notifications`, calling `snooze.scan_wakes` before priority scanning
  so newly-awake items get scored.

## C. Pre-drafted replies on critical push

When `scan_top_priorities` rates a commitment critical AND it came from a real
email, the worker generates a draft reply BEFORE pushing. The push payload
carries `draft_reply_id` + `deep_link: /draft/{id}` so the mobile lands on a
review-and-send screen.

- Backend: `app/services/prep_draft.py` (idempotent on `(user_id, message_id)`),
  hook in `scan_top_priorities`.
- Failure mode: LLM hiccup → push still fires, deep-link falls back to `/today`.

## D. Schedule-conflict detection

The 30-min scan now also looks for overlapping calendar events in the next 48h.
One push per ordered (id_a, id_b) pair, deduped via `conflict:<lo>:<hi>`.

**Code:** `scan_schedule_conflicts` in `app/services/notifications.py`.

## E. iOS Shortcut voice capture

Lock-screen / Siri / Control Center dictation → `albert://capture?text=...` →
the capture screen auto-submits. See `mobile/docs/SIRI_VOICE_CAPTURE.md` for
the 2-minute Shortcut setup.

**Code:** `mobile/app/capture.tsx` (deep-link param), `mobile/src/screens/CaptureScreen.tsx`
(auto-submit on `initialText`).

## F. Outbound reply tracking

When Alfred sends a reply (capability `send_email`), it persists an
`OutboundReply` watching the thread. A scanner:

- **resolves** the watch when ingestion sees a new inbound on the same
  thread from someone other than the user;
- **pushes** `follow_up_due` if no response after `SILENCE_DAYS=3`.

This closes the loop on the user's commitments — the cousin to the
waiting-on-you aging push (which covers other people's commitments).

- Backend: `app/services/outbound_tracking.py`.
- Model: `app/db/models/outbound_reply.py`.
- Migration: `a1b2c3d4e5f6_add_outbound_replies.py`.
- Hook: `SendEmailCapability.execute` calls `record_send`.

## G. Importance learning

The priority ranker now reads a per-user `learning` snapshot from
`user.preferences.learning`. Two axes:

- **by_sender**: +1.5 on act (done), -1.0 on dismiss, bounded ±15 with
  gentle decay so old signals fade.
- **by_category**: same weights, keyed by money / legal / ask / meeting /
  incident — driven by substring matches on the commitment text.

The combined adjustment is capped at ±20 so learning shifts items but never
dominates the deterministic baseline. Every status change through
`/commitments/{id}/status` feeds the loop.

- Backend: `app/services/learning.py`, wired into `priority.score_commitment`
  via `ScoringContext.learning`.
- Storage: JSON in `user.preferences.learning`. No migration needed.

## H. Search across messages + commitments

`GET /api/v1/search?q=...&kind=message&kind=commitment&limit=20`. One screen,
mixed result list with a kind chip.

- Postgres: `to_tsvector('english', ...)` + `websearch_to_tsquery` + ts_rank.
- SQLite (tests): ILIKE token-AND across the same columns + count-based score.
- Open commitments get a +0.15 status boost so a finished item ranks below
  an open one with similar relevance.

- Backend: `app/services/search.py`, `app/api/v1/search.py`.
- Mobile: `mobile/app/search.tsx`, reachable from the magnifier on Today.

## Verify gate

```
cd backend && uv run pytest -q && uv run ruff check app/ tests/
cd mobile && bun run typecheck
```

189 backend tests pass. Mobile typechecks clean.

## Deploy

Backend rides the standard git-archive + scp + restart pipeline; two new
migrations (a1b2c3d4e5f6 + b2c3d4e5f6a7) run automatically on deploy.

Mobile rides EAS Update: `bunx eas update --branch preview -m "feature pack
A-H"`. No native code changed; the installed app picks up the new screens on
next launch.
