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

## User flow (install + optional share import)

1. **You** → **SMS forwarding** → **Install Shortcut** (Albert SMS Forward).
2. Paste **X-Sms-Token** when prompted.
3. Create automation: **When I receive a message** → run **Albert SMS Forward**
   immediately.
4. (Optional) **You** → **Install Share shortcut** — share older texts from
   Messages to import them one at a time.
5. Open **Inbox** → **SMS**, pull to refresh, tap **Reply** on a thread.

## iOS Shortcuts (recommended)

Albert ships **signed** shortcut files. iOS rejects unsigned `.shortcut` downloads
with *Importing unsigned shortcut files is not supported* — always use the link
from Albert settings or the signed URLs below.

Both shortcuts use only actions that import reliably on recent iOS builds:
`Get Text from Input` (`detect.text`), `Dictionary`, `Generate Hash`, and
`Get Contents of URL`. They do **not** embed *Get Details of Messages*,
*Find Messages*, or *Get Contacts* — those action IDs often show as *Unknown Action*
when shipped in signed plists.

**If you see Unknown Action blocks:** delete the shortcut (**Shortcuts** → **…** →
**Delete Shortcut**), then re-import from Albert settings.

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

### Albert SMS Share (older texts, one at a time)

Bulk “sync last 10 texts” is not available on all iOS versions because *Find Messages*
often fails to import. Instead, share individual messages to Albert:

1. Open **You** → **SMS forwarding**.
2. Tap **Install Share shortcut** / **安装分享快捷指令** (opens Safari).
3. Tap **Add Shortcut**, paste **X-Sms-Token** if prompted.
4. In **Messages**, open a thread → long-press a message → **Share** →
   **Albert SMS Share**.
5. Repeat for other texts you want in Albert; pull to refresh **Inbox** → **SMS**.

Signed download:

`https://alfredaitech.com/api/v1/integrations/ios/Albert-SMS-Share.shortcut`

Legacy URL (same file):

`https://alfredaitech.com/api/v1/integrations/ios/Albert-SMS-Backfill.shortcut`

Re-sharing the same message body is safe — `message_id` is a stable hash and
Albert dedupes via `external_id`.

### Forward shortcut actions (v3)

| Step | Action ID | Purpose |
| ---- | --------- | ------- |
| 1 (import) | `is.workflow.actions.gettext` | Prompt for X-Sms-Token |
| 2 | `is.workflow.actions.detect.text` | Message body from Shortcut Input |
| 3 | `is.workflow.actions.dictionary` | JSON payload (`body` only) |
| 4 | `is.workflow.actions.downloadurl` | POST to Albert webhook |

### Share shortcut actions (v3)

| Step | Action ID | Purpose |
| ---- | --------- | ------- |
| 1 (import) | `is.workflow.actions.gettext` | Prompt for X-Sms-Token |
| 2 | `is.workflow.actions.detect.text` | Body from Share sheet input |
| 3 | `is.workflow.actions.hash` | Stable `message_id` for dedup |
| 4 | `is.workflow.actions.dictionary` | Payload (`backfill: true`) |
| 5 | `is.workflow.actions.downloadurl` | POST to Albert webhook |

### Add sender phone manually (optional)

If your device supports *Get Details of Messages* when you add it in the Shortcuts
editor (manually added actions use different internal IDs than signed imports):

1. Open **Shortcuts** → **Albert SMS Forward** → edit.
2. After **Get Text from Input**, tap **+** → **Get Details of Messages**.
3. Choose **Phone Number**.
4. In **Dictionary**, add key `from_number` → **Phone Number** from step 2.
5. (Optional) Add **Get Contacts from Input** → **Get Name** → `from_name`.

Without `from_number`, Albert stores the message but **Open in Messages** shows
*Missing phone number for this text* instead of pre-filling the recipient.

### Manual build (maintainers)

From a Mac with the `shortcuts` CLI:

```bash
python3 backend/scripts/build_sms_shortcut.py
```

Commit or ship these files under `backend/integrations/ios/` before deploying:

- `Albert-SMS-Forward.shortcut`
- `Albert-SMS-Share.shortcut`
- `Albert-SMS-Backfill.shortcut` (byte-identical alias for old links)

Example JSON body (forward):

```json
{
  "body": "Can we meet tomorrow?"
}
```

Example JSON body (share / backfill):

```json
{
  "body": "Can we meet tomorrow?",
  "message_id": "abc123…",
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

| Symptom | Likely cause | Fix |
| ------- | -------------- | --- |
| **Unknown Action** blocks | Old shortcut or unsupported embedded actions | Delete shortcut, re-import from Albert settings. |
| **The shortcut URL provided was invalid** | `shortcuts://` from in-app Linking | Tap install/share button again (opens HTTPS in Safari). |
| **Importing unsigned shortcut files is not supported** | Unsigned server build | Maintainer: `python3 backend/scripts/build_sms_shortcut.py` and redeploy. |
| **401 Missing/Invalid X-Sms-Token** | Wrong or missing header | Copy token again from Albert → You → SMS forwarding |
| **422 Unprocessable Entity** | Body shape from Shortcuts | Use **Text** for phone; ensure `body` is message text |
| **400 SMS body is required** | Empty message text | Map `body` via **Get Text from Input** |
| SMS missing in Inbox | Sync delay | Pull to refresh; confirm curl returns 200 first |
| Reply opens Messages without recipient | No sender phone from Shortcut | Expected on v3 forward; add **Get Details of Messages** manually |
| Old texts not in Inbox | No bulk backfill on your iOS | Share each message via **Albert SMS Share** |

## Reply flow in the app

1. SMS appears in **Inbox** with an **SMS** tag.
2. Tap **Reply** — Albert loads the text and shows a draft.
3. Tap **Open in Messages** — iOS opens Messages with the draft filled in (when
   `reply_phone` is available).
4. Review and tap **Send** on your phone.

If the sender phone is unknown, Albert shows **Missing phone number for this text**
instead of opening Messages with a bogus number.

## API

| Method | Path | Auth |
| ------ | ---- | ---- |
| GET | `/api/v1/me/sms-forwarding` | JWT (app session) |
| GET | `/api/v1/me/sms-forwarding/install` | JWT |
| GET | `/api/v1/me/sms-forwarding/backfill` | JWT (Share shortcut install) |
| GET | `/api/v1/integrations/ios/Albert-SMS-Forward.shortcut` | none (signed file) |
| GET | `/api/v1/integrations/ios/Albert-SMS-Share.shortcut` | none (signed file) |
| GET | `/api/v1/integrations/ios/Albert-SMS-Backfill.shortcut` | none (legacy alias) |
| POST | `/api/v1/inbox/sms` | Header `X-Sms-Token` |
