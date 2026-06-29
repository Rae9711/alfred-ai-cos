

# SMS forwarding (iOS Shortcut)

Albert can treat forwarded SMS like email: classify, draft a reply, then open the
system **Messages** app with the recipient and body pre-filled. You tap **Send**
from your personal number.

Email/Gmail sync is unchanged. SMS uses a separate webhook.

## Setup in Albert

1. Open **You** (settings).
2. Under **SMS forwarding**, copy:
  - **Webhook URL** — `https://alfredaitech.com/api/v1/inbox/sms`
  - **X-Sms-Token** — your personal secret (never share publicly).

## User flow (install + backfill once)

1. **You** → **SMS forwarding** → **Install Shortcut** (Albert SMS Forward).
2. Paste **X-Sms-Token** when prompted.
3. Create automation: **When I receive a message** → run **Albert SMS Forward**
  immediately.
4. **You** → **Sync last 10 texts** (Albert SMS Backfill) — run once from
  Shortcuts to import recent incoming texts for reply testing. Safe to re-run;
   duplicates are skipped via `message_id`.
5. Open **Inbox** → **SMS**, pull to refresh, tap **Reply** on a thread.

## iOS Shortcuts (recommended)

Albert ships **signed** shortcut files. iOS rejects unsigned `.shortcut` downloads
with *Importing unsigned shortcut files is not supported* — always use the link
from Albert settings or the signed URLs below.

Both shortcuts use widely-supported actions (`Get Text from Input`, `Get Details of Messages` via `is.workflow.actions.properties.messages`, `Dictionary`,
`Get Contents of URL`). They do **not** use *Get Details of Content Item* /
`contentitemproperties` — those action IDs vary by iOS version and often show as
*Unknown Action* blocks.

### Albert SMS Forward (automation)

**If you already imported an older Albert SMS Forward shortcut**, delete it first
(**Shortcuts** → **Albert SMS Forward** → **…** → **Delete Shortcut**), then
install again.

1. Open **You** → **SMS forwarding**.
2. Tap **Install shortcut** (opens the signed download in Safari; tap **Add Shortcut**).
3. When prompted, paste your **X-Sms-Token** from the same screen.
4. Create the automation: **When I receive a message** → run **Albert SMS Forward**
  immediately.

Signed download:

`https://alfredaitech.com/api/v1/integrations/ios/Albert-SMS-Forward.shortcut`

### Albert SMS Backfill (run once manually)

Imports your **10 most recent incoming texts** (not from you) so you can test
reply drafts without waiting for new messages.

1. Open **You** → **SMS forwarding**.
2. Tap **Sync last 10 texts** / **同步最近 10 条短信** (opens Safari).
3. Tap **Add Shortcut**, paste **X-Sms-Token** if prompted.
4. Open **Shortcuts** → **Albert SMS Backfill** → **Run** (play button).
5. Pull to refresh **Inbox** → **SMS**.

Signed download:

`https://alfredaitech.com/api/v1/integrations/ios/Albert-SMS-Backfill.shortcut`

Re-running backfill is safe — each message sends a stable `message_id` (hash of
body) and Albert dedupes via `external_id`.

### Forward shortcut actions


| Step       | Action ID                                 | Purpose                                      |
| ---------- | ----------------------------------------- | -------------------------------------------- |
| 1 (import) | `is.workflow.actions.gettext`             | Prompt for X-Sms-Token                       |
| 2          | `is.workflow.actions.dictionary`          | JSON payload (`body`, `text`, `shortcut_input` → Shortcut Input) |
| 3          | `is.workflow.actions.downloadurl`         | POST to Albert webhook                       |


After import, open **Shortcuts → Albert SMS Forward** and confirm the **Dictionary**
action lists **three keys** (`body`, `text`, `shortcut_input`), each mapped to
**Shortcut Input** — not an empty dictionary with only *Add New Item*. The POST step
should show **JSON** request body and headers **Content-Type** + **X-Sms-Token**.

The forward shortcut maps **Shortcut Input** (the incoming message from the automation
trigger) into the JSON body. Sender phone is not included
(Message Received does not expose it reliably on all iOS versions) — **Open in Messages**
may show a toast instead of pre-filling the recipient unless you add **Get Details of
Messages** manually (advanced).

### iOS automation: empty Shortcut Input

On some iOS versions the **Message Received** trigger passes an empty Shortcut Input.
If Albert returns **400 SMS body is required**, try:

1. Delete the old shortcut and automation; re-import from **You → SMS forwarding**.
2. Automation: **When I receive a message** → **Run Immediately** (no confirmation).
3. Ensure the automation runs **Albert SMS Forward** (not a duplicate/old name).
4. Send yourself a test text; confirm curl works first (see below).
5. As a fallback, use **Albert SMS Share** from the message Share sheet for one-off imports.

### Backfill shortcut actions


| Step       | Action ID                                 | Purpose                           |
| ---------- | ----------------------------------------- | --------------------------------- |
| 1 (import) | `is.workflow.actions.gettext`             | Prompt for X-Sms-Token            |
| 2          | `is.workflow.actions.filter.messages`     | Latest 10, **Is From Me** = false |
| 3          | `is.workflow.actions.repeat.each`         | Loop over messages                |
| 4          | `is.workflow.actions.detect.text`         | Body                              |
| 5          | `is.workflow.actions.properties.messages` | Phone + date                      |
| 6          | `is.workflow.actions.detect.contacts`     | Contact                           |
| 7          | `is.workflow.actions.properties.contacts` | Name                              |
| 8          | `is.workflow.actions.hash`                | Stable `message_id` for dedup     |
| 9          | `is.workflow.actions.dictionary`          | Payload (`backfill: true`)        |
| 10         | `is.workflow.actions.downloadurl`         | POST each message                 |
| 11         | `is.workflow.actions.repeat.each`         | End repeat                        |


### Manual build (maintainers)

From a Mac with the `shortcuts` CLI:

```bash
python3 backend/scripts/build_sms_shortcut.py
```

Commit or ship both files under `backend/integrations/ios/` before deploying:

- `Albert-SMS-Forward.shortcut`
- `Albert-SMS-Backfill.shortcut`

### Manual backfill (if Find Messages fails)

1. **Find Messages** — sort by Date, latest first, limit 10, filter **Is From Me**
  is false.
2. **Repeat with Each**:
  - **Get Text from Input** → `body`
  - **Get Details of Messages** → **Phone Number** → `from_number` (if supported)
  - **Dictionary** with `body`, `from_number`, `backfill: true`
  - **Get Contents of URL** — POST to webhook with `X-Sms-Token`

### With sender phone (if your iOS supports it)

If *Get Details of Messages* works on your device, ensure it uses
`properties.messages` (not `contentitemproperties`). Use **Phone Number** for
`from_number`.

Example JSON body:

```json
{
  "from_number": "+15551234567",
  "body": "Can we meet tomorrow?",
  "from_name": "Alex",
  "message_id": "abc123",
  "backfill": true
}
```

Albert also accepts aliases: `fromNumber`, `phone`, `sender_phone`, `sender` for
the phone and `text`, `message`, `content` for the body. If `from_number` is
missing, Albert stores the message but does not expose a `reply_phone` in the app
(**Open in Messages** shows a toast instead).

## Test with curl

Replace `YOUR_TOKEN` with the token from Albert settings:

```bash
curl -sS -X POST 'https://alfredaitech.com/api/v1/inbox/sms' \
  -H 'Content-Type: application/json' \
  -H 'X-Sms-Token: YOUR_TOKEN' \
  -d '{"from_number":"+15551234567","body":"curl test message","backfill":true}'
```

Success looks like:

```json
{"message_id":"...","commitments_extracted":0,"deduped":false,"draft_created":true}
```

## Troubleshooting


| Symptom                                                | Likely cause                            | Fix                                                                       |
| ------------------------------------------------------ | --------------------------------------- | ------------------------------------------------------------------------- |
| **Unknown Action** blocks                              | Old shortcut or `contentitemproperties` | Delete shortcut, re-import from Albert settings (~20+ KB signed file).    |
| **The shortcut URL provided was invalid**              | `shortcuts://` from in-app Linking      | Tap install/sync button again (opens HTTPS in Safari).                    |
| **Importing unsigned shortcut files is not supported** | Unsigned server build                   | Maintainer: `python3 backend/scripts/build_sms_shortcut.py` and redeploy. |
| **401 Missing/Invalid X-Sms-Token**                    | Wrong or missing header                 | Copy token again from Albert → You → SMS forwarding                       |
| **422 Unprocessable Entity**                           | Body shape from Shortcuts               | Use **Text** for phone; ensure `body` is message text                     |
| **Dictionary shows only *Add New Item***                  | ActionOutput refs stripped on import    | Delete shortcut, re-import signed Forward from Albert settings; Dictionary must show 3 keys. |
| SMS missing in Inbox                                   | Sync delay                              | Pull to refresh; confirm curl returns 200 first                           |
| Reply opens Messages without recipient                 | No sender phone from Shortcut           | Expected if Get Details fails; add **Get Details of Messages** manually   |
| Backfill shows 0 new texts                             | All 10 already imported                 | Re-run is safe (deduped); send a new test SMS                             |


## Reply flow in the app

1. SMS appears in **Inbox** with an **SMS** tag.
2. Tap **Reply** — Albert loads the text and shows a draft.
3. Tap **Open in Messages** — iOS opens Messages with the draft filled in (when
  `reply_phone` is available).
4. Review and tap **Send** on your phone.

If the sender phone is unknown, Albert shows **Missing phone number for this text**
instead of opening Messages with a bogus number.

## API


| Method | Path                                                    | Auth                 |
| ------ | ------------------------------------------------------- | -------------------- |
| GET    | `/api/v1/me/sms-forwarding`                             | JWT (app session)    |
| GET    | `/api/v1/me/sms-forwarding/install`                     | JWT                  |
| GET    | `/api/v1/me/sms-forwarding/backfill`                    | JWT                  |
| GET    | `/api/v1/integrations/ios/Albert-SMS-Forward.shortcut`  | none (signed file)   |
| GET    | `/api/v1/integrations/ios/Albert-SMS-Backfill.shortcut` | none (signed file)   |
| POST   | `/api/v1/inbox/sms`                                     | Header `X-Sms-Token` |


