# Plan: calendar booking + durable deploy

Two deliverables:
- **A. Calendar booking** — "book my calendar tomorrow 5-6pm" creates a real Google
  Calendar event. Today: impossible (readonly scope, no create capability, no NL path).
- **B. Durable deploy** — Hetzner so it survives the laptop; friends log in with their
  own email once added as Google test users.

Legend: **[C]** Claude does · **[A]** Adam does (accounts/access I can't reach).

---

## A. Calendar booking

### A1. Write scope  [C code, [A] re-consent]
- config.py google_scopes: add `https://www.googleapis.com/auth/calendar.events`
  (keep calendar.readonly). **Consequence: every existing Google token is invalidated;
  all users must re-consent.** Bundle with deploy so everyone re-auths ONCE.

### A2. gcal write method  [C]
- `gcal.create_event(token_payload, *, title, start, end, description, location)` →
  events().insert(calendarId="primary"). Returns the created event (id, htmlLink).
- `calendar.py` service wrapper that decrypts the user's token + calls it.

### A3. Capability + action type  [C]
- enums.ActionType: add `create_calendar_event`.
- enums.RiskLevel: calendar create = `reversible_write` (level 2) — it's your own
  calendar, deletable. (Inviting others would be level 3; v1 books only your time.)
- New provider `capabilities/providers/calendar_event.py` (validate start<end, title;
  execute → calendar service). Register in capabilities/__init__.py.

### A4. Natural-language path  [C]
- The Ask screen ("book my calendar tomorrow 5-6pm") needs a backend that parses intent
  → proposes a create_calendar_event action → executes (level 2 = no approval needed,
  but we still surface a confirmation card for trust).
- New `POST /assistant/ask` (or extend capture's parser): LLM extracts {intent: book,
  title, start, end} from the text + the user's timezone, builds the action, runs it.
- Wire AskScreen to call it; show the result ("Booked 5-6pm tomorrow ✓") + the event.

### A5. Tests  [C]
- gcal.create_event payload shape; capability validate (start<end, missing title);
  NL parse ("tomorrow 5 to 6pm" → correct start/end in the user's tz); end-to-end with a
  mocked Google client.

---

## B. Durable deploy (Hetzner)  — artifacts from Phase 1 already exist

Blocked on the SAME things as before (still unresolved):
- **[A] domain**: A record `albert.alfredassistants.com` → Hetzner IP.
- **[A] VPS access**: SSH key for me, or you run my commands. Confirm Docker present.
- **[A] inspection output**: the read-only commands (docker ps / ss / caddy / df -h …)
  so I write the Caddy site block + confirm ports.
- **[A] Expo account** + `expo login` (for EAS Update so the APP also survives the laptop).
- **[A] secrets**: production `.env` on the server (I never read your secrets).
- **[A] Google Console**: prod redirect URI + the **calendar.events scope re-consent** +
  the 3 friends as test users.

What I do once unblocked: Caddy site block, server deploy sequence, EAS config + publish,
verify from a non-local network.

---

## Honest blocker summary
- **A (calendar) I can build + test fully now** — it's all code.
- **B (deploy) I CANNOT finish alone** — it needs your VPS/DNS/Expo/Console. I've built
  every code/config artifact; the remaining steps are inherently yours.
- The calendar scope change forces a one-time re-consent → do it as part of the deploy
  so friends re-auth once, not twice.

## Order
1. Build + test A (calendar) entirely. Commit/push each step. ← doable now
2. Deploy B with your inputs. The scope change ships in the same deploy.
