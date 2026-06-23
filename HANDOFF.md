# Handoff: Mobile + Gmail sync integration (Rae → Azzbee)

**Date:** June 2026  
**Source branch:** `Rae9711/alfred-ai-cos` `master` @ `6490d4c` (7 commits ahead of `Azzbee/alfred-ai-cos` `master`)  
**Target:** `Azzbee/alfred-ai-cos` `master`  
**Production API:** `https://albert.alfredassistants.com` (not yet updated with this code)

This document is for whoever merges, deploys, and continues the work (Adam / Azzbee team).

---

## TL;DR

| Item | Status |
|------|--------|
| Code pushed to `github.com/Rae9711/alfred-ai-cos` | ✅ |
| PR into `Azzbee/alfred-ai-cos` | Open (see PR link in GitHub) |
| Production Hetzner deploy | ❌ Blocked — needs SSH to `89.167.84.193` |
| Mobile OTA (Expo preview) | ✅ Published earlier; app talks to prod API |
| Ask “general chat” | ❌ Not implemented — `/assistant/ask` only books calendar |

**Merge note:** `Azzbee/master` has **6 commits** (PRD P1–P12 agents) that are **not** in this branch. Expect merge conflicts in backend services and possibly mobile screens. Cherry-pick `ab96131` + `6490d4c` if you only want Gmail/mobile wiring without the full branch.

---

## What this branch adds (commit by commit)

### `6490d4c` — Gmail Primary-only Inbox filter

**Problem:** Promotions mail (e.g. marketing) appeared in the mobile Inbox / FYI.

**Backend:**
- `Message.gmail_labels` JSON column — migration `e5f6a7b8c9d0_add_message_gmail_labels.py`
- Ingest stores only messages with Gmail labels `INBOX` + `CATEGORY_PERSONAL`
- Sync refreshes labels on the ~120 most recent messages
- `backend/app/services/inbox_filter.py` — `message_in_primary_inbox()`
- `GET /api/v1/messages` filters out Promotions / Social / Updates / Forums

**Tests:** `backend/tests/test_inbox_primary_filter.py`

**After deploy:** Users pull-to-refresh Inbox; existing rows get labels on next sync.

---

### `ab96131` — Live Gmail sync + mobile wiring (largest change)

**Backend — incremental sync:**
- First connect (`gmail_history_id` null): backfill **50** Primary inbox messages
- Incremental: Gmail History API; filter `CATEGORY_PERSONAL`
- History expired: fallback poll 20 Primary messages
- Migration `d4e5f6a7b8c9_add_gmail_history_id.py` on `connected_account`
- Classification prompt tweaks (confirmed meetings / Zoom → `informational` / FYI)
- Scripts: `backend/scripts/classify_inbox_sample.py`, `backend/scripts/test_reply_flow.py`
- Tests: `backend/tests/test_ingestion_sync.py`

**Mobile — real APIs:**
- `MailboxContext` — login → sync → `getInbox()`
- `InboxScreen` — live inbox, pull-to-refresh
- `HomeScreen` — `/today`, meetings, priorities, composer (`api.ask`)
- `AskScreen` — free chat via `/assistant/ask`; reply flow via `WorkflowContext` + Gmail send
- `WorkflowContext`, `inbox.ts` (API categories → UI sections), i18n
- Butler avatar art in `butlerAvatarArt.tsx`

**UI mapping:** `needs_reply` and `needs_decision` both render under **「需要回复」**; tag shows actual category (e.g. `NEEDS DECISION`).

**Reply/send path tested locally:** `DraftReply` → `propose_send_draft` → `approve` → `gmail.send_message`.

---

### `814c6f9` — Avatar design playground (dev only)

- `mobile/demo/avatar-sim/` — browser sim for butler SVG; not shipped in app binary
- `mobile/docs/AVATAR_LOTTIE_BRIEF.md`

---

### `652a7a3` — Companion avatar strict-mode fixes + docs

- TypeScript fixes for `noUncheckedIndexedAccess`
- `mobile/docs/COMPANION_AVATAR.md`

---

### `91c2a96` — `urgencyFor` timezone bug

- `mobile/src/lib/today.ts` — date-only due dates parsed as **local**, not UTC midnight

---

### `4e3c036` + `c2f3a28` — Companion avatar + dev tooling

- Companion avatar (XP, streaks, leveling) with race-condition fixes
- `secureStorage`, web CORS proxy (`mobile/scripts/dev-api-proxy.mjs`)
- Standalone iOS / EAS: `mobile/scripts/standalone-ios.sh`, `bun run update:preview`
- See `mobile/scripts/README.md`

---

## What is on `Azzbee/master` but NOT in this branch

```
6c50ab3 PRD P7-P12: Notion + Todoist + Slack + Drive + Stripe + share-sheet
2c19298 PRD P6: Auto-approve policies
4239072 PRD P5: Recurring workflows
a381c7c PRD P4: Memory Agent
b85a4ad PRD P3: Planning Agent
40d1fe8 PRD P1+P2: Person and Project entities
```

Integrate carefully — do not force-push either side.

---

## Deploy checklist (production)

Full instructions: `deploy/HETZNER.md`

```bash
# From laptop with SSH to Hetzner
git archive --format=tar.gz -o /tmp/albert-src.tar.gz master
scp /tmp/albert-src.tar.gz root@89.167.84.193:/tmp/
ssh root@89.167.84.193 'set -e
  cd /root/albert && find . -mindepth 1 -maxdepth 1 ! -name backend -exec rm -rf {} + 2>/dev/null || true
  tar -xzf /tmp/albert-src.tar.gz -C /root/albert
  cd backend && /root/.local/bin/uv sync --no-dev
  /root/.local/bin/uv run alembic upgrade head
  systemctl restart albert-web albert-worker albert-beat'
```

**Migrations to apply:**
1. `d4e5f6a7b8c9` — `gmail_history_id` on connected accounts
2. `e5f6a7b8c9d0` — `gmail_labels` on messages

**Verify:**
```bash
curl -s https://albert.alfredassistants.com/health
journalctl -u albert-web -n 30 --no-pager
```

---

## Post-deploy data / QA

### Re-classify existing mail (optional)

Sync only classifies rows where `classification IS NULL`. Old wrong labels (e.g. appointment reminder → `needs_decision` instead of FYI) persist until re-run:

```bash
cd backend
uv run python scripts/classify_inbox_sample.py --account USER@EMAIL.com --reclassify
```

### Mobile smoke test

1. Force-quit app (pick up latest OTA if needed: `cd mobile && bun run update:preview`)
2. Login with Gmail (must be Google OAuth test user)
3. **Inbox** — pull refresh; Promotions should not appear; Primary only
4. **Home** — priorities from `/today`
5. **Inbox → Reply** — draft loads → Send (approval spine)
6. **Ask** — “book my calendar tomorrow 3-4pm” works
7. **Ask** — “what am I forgetting?” still returns calendar-only refusal (**expected** until `/assistant/chat` is built)

### Test reply flow (local or staging)

```bash
cd backend
uv run python scripts/test_reply_flow.py --account USER@EMAIL.com
```

---

## Known gaps (not in this PR)

| Gap | Detail |
|-----|--------|
| **Ask general chat** | `POST /assistant/ask` only interprets calendar booking. PRD 10.2 queries (“what am I forgetting?”) need a new `/assistant/chat` endpoint with `/today` + inbox context. |
| **Misleading Ask greeting** | Static copy in `mobile/src/i18n/locales.ts`, not from `/today`. |
| **Stale classifications** | Deploy alone does not fix already-classified messages. |
| **Production not deployed** | Phone testing against prod API still runs **old** backend until Hetzner deploy. |
| **SSH access** | Deploy was blocked during Rae’s session (permission denied to `root@89.167.84.193`). |

---

## Mobile / Expo

- API base URL: `mobile/app.json` → `extra.apiBaseUrl` = `https://albert.alfredassistants.com`
- OTA updates: `cd mobile && bun run update:preview -- "your message"`
- Standalone iOS build: `bun run device:ios` (see `mobile/EAS.md`)
- Web dev uses CORS proxy on `localhost:8000` (`mobile/scripts/dev-api-proxy.mjs`)

---

## Suggested merge strategy

**Option A — Full merge (recommended if you want all Rae work):**
```bash
git fetch https://github.com/Rae9711/alfred-ai-cos.git rae-master:rae-master
git checkout master
git merge rae-master
# resolve conflicts, run tests
```

**Option B — Cherry-pick only Gmail + mobile:**
```bash
git cherry-pick ab96131 6490d4c
```

**After merge, run:**
```bash
cd backend && uv run pytest
cd mobile && bun run test && bunx tsc --noEmit
```

---

## Contacts / accounts used in testing

- Gmail test accounts: `ruiraywang97@gmail.com`, `whruiray@umich.edu`
- Classification QA reports: `backend/reports/classification_primary_*.csv`

---

## Next priorities (product)

1. **Deploy backend** to Hetzner (unblocks real phone testing)
2. **Merge** this PR with Azzbee PRD work
3. **Re-classify** prod mail or add sync-time reclassify flag
4. **Build `/assistant/chat`** — multi-turn + today/inbox context (see conversation in PR description)
5. **Map `needs_decision`** — product decision: FYI section vs reply section when `action_required=false`
