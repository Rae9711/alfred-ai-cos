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

## iOS Shortcut (recommended)

Albert ships a **signed** shortcut file. iOS rejects unsigned `.shortcut` downloads with
*Importing unsigned shortcut files is not supported* — always use the link from Albert
settings or the signed URL below, not a hand-built unsigned plist.

The shortcut uses widely-supported actions plus **Get Details of Messages** with the
correct action ID (`is.workflow.actions.properties.messages`). Older builds used
`properties.contentitems`, which shows as *Unknown Action* on many iPhones.

### One-tap install (easiest)

**If you already imported an older Albert SMS Forward shortcut**, delete it first
(**Shortcuts** → **Albert SMS Forward** → **…** → **Delete Shortcut**), then install
again — older builds used invalid *Get Details* action IDs or sent a placeholder phone.

1. Open **You** → **SMS forwarding**.
2. Tap **Install shortcut** (opens the signed download in Safari; tap **Add Shortcut**).
3. When prompted, paste your **X-Sms-Token** from the same screen.
4. Create the automation: **When I receive a message** → run **Albert SMS Forward**
   immediately.

Signed download (Safari or Shortcuts import):

`https://alfredaitech.com/api/v1/integrations/ios/Albert-SMS-Forward.shortcut`

One-tap Shortcuts deep link (paste in Safari if the in-app button fails):

`shortcuts://import-shortcut/?url=https%3A%2F%2Falfredaitech.com%2Fapi%2Fv1%2Fintegrations%2Fios%2FAlbert-SMS-Forward.shortcut&name=Albert+SMS+Forward`

A signed file is ~23 KB; if the download is only ~2 KB, the server is serving an
unsigned build — contact support or retry after a redeploy.

### What the shortcut does

| Step | Action ID | Purpose |
| ---- | --------- | ------- |
| 1 (import) | `is.workflow.actions.gettext` | Prompt for X-Sms-Token |
| 2 | `is.workflow.actions.detect.text` | Message text from Shortcut Input |
| 3 | `is.workflow.actions.properties.messages` | Sender phone (`Phone Number`) |
| 4 | `is.workflow.actions.detect.contacts` | Contact for sender (name) |
| 5 | `is.workflow.actions.properties.contacts` | Sender display name |
| 6 | `is.workflow.actions.dictionary` | `body`, `from_number`, `from_name` |
| 7 | `is.workflow.actions.downloadurl` | POST JSON to Albert webhook |

**Message Received** passes the incoming message as Shortcut Input. Step 3 reads the
real sender number; Albert uses it for **Open in Messages**. If phone extraction fails
(empty or unsupported on your iOS build), Albert still ingests the text but disables
reply until you fix the shortcut.

### Manual build (maintainers)

From a Mac with the `shortcuts` CLI:

```bash
python3 backend/scripts/build_sms_shortcut.py
```

Commit or ship `backend/integrations/ios/Albert-SMS-Forward.shortcut` before deploying.
The deploy image bundles that file; unsigned plists are generated at build time on macOS
only.

### iCloud share link (fallback)

If Safari import still fails on some iOS versions:

1. On a Mac, open the signed `.shortcut` in Shortcuts.
2. **Share** → **Copy iCloud Link**.
3. Open that link on the iPhone and tap **Add Shortcut**.

### Manual shortcut (advanced)

Create an automation in the **Shortcuts** app:

1. **Trigger:** *When I receive a message* → Run Immediately.
2. **Get Text from Input** — input: *Shortcut Input* (message body).
3. **Get Details of Messages** from *Shortcut Input* → **Phone Number**
   (not the generic *Get Details of Content Items* — that action ID breaks on many devices).
4. **Get Contacts from Input** from *Shortcut Input* → **Get Details of Contacts** → **Name** (optional).
5. **Dictionary** with keys:
  - `body` → text from step 2
  - `from_number` → phone from step 3
  - `from_name` → name from step 4 (optional)
6. **Get Contents of URL**
  - Method: **POST**
  - URL: webhook from Albert settings
  - Headers:
    - `Content-Type: application/json`
    - `X-Sms-Token: <your token>`
  - Request body: **File** → the Dictionary from step 5 (Shortcuts serializes it as JSON)

### If sender phone still missing

On some iOS versions, **Get Details of Messages** may not appear or may return empty.
Try these on your device (add between steps 2 and 5 above):

| Approach | Actions to add | Notes |
| -------- | -------------- | ----- |
| Message details | *Get Details of Messages* → **Phone Number** | Preferred; matches shipped shortcut |
| Contact lookup | *Get Contacts from Input* → *Get Details of Contacts* → **Phone Number** | Works when sender is in Contacts |
| Phone scan | *Get Phone Numbers from Input* | May work if the message object embeds a number |

Do **not** wire the **Numbers** magic variable directly unless you must — it is often
sent as `[15551234567]` instead of a string (Albert coerces arrays, but text is safer).

In **Message Received** automations on iOS 18+, tap the variable pill after the trigger
and check whether **Sender** is offered as a magic variable — if so, use that for
`from_number` instead of step 3.

Example JSON body (what Albert expects after coercion):

```json
{
  "from_number": "+15551234567",
  "body": "Can we meet tomorrow?",
  "from_name": "Alex"
}
```

Albert also accepts aliases: `fromNumber`, `phone`, `sender_phone`, `sender` for the phone
and `text`, `message`, `content` for the body. If `from_number` is missing or empty,
Albert stores the message with an internal placeholder and **does not** expose a reply
phone until a real number is supplied.

## Test with curl

Replace `YOUR_TOKEN` with the token from Albert settings:

```bash
curl -sS -X POST 'https://alfredaitech.com/api/v1/inbox/sms' \
  -H 'Content-Type: application/json' \
  -H 'X-Sms-Token: YOUR_TOKEN' \
  -d '{"from_number":"+15551234567","body":"curl test message"}'
```

Body-only (fallback when shortcut cannot read sender):

```bash
curl -sS -X POST 'https://alfredaitech.com/api/v1/inbox/sms' \
  -H 'Content-Type: application/json' \
  -H 'X-Sms-Token: YOUR_TOKEN' \
  -d '{"body":"curl test message"}'
```

Success looks like:

```json
{"message_id":"...","commitments_extracted":0,"deduped":false,"draft_created":true}
```

## Troubleshooting


| Symptom                             | Likely cause                     | Fix                                                                    |
| ----------------------------------- | -------------------------------- | ---------------------------------------------------------------------- |
| **Unknown Action** blocks in shortcut | Old shortcut used `properties.contentitems` | Delete **Albert SMS Forward**, re-import from **Install shortcut** or the signed URL below (~23 KB). |
| **The shortcut URL provided was invalid** | `shortcuts://import-shortcut` from in-app Linking | Tap **Install shortcut** again (opens HTTPS in Safari), or paste the signed download URL above in Safari. |
| **Importing unsigned shortcut files is not supported** | Unsigned `.shortcut` from server | Use **Install shortcut** in Albert → You, or the signed URL (~23 KB). Maintainer: run `python3 backend/scripts/build_sms_shortcut.py` and redeploy. |
| **401 Missing/Invalid X-Sms-Token** | Wrong or missing header          | Copy token again from Albert → You → SMS forwarding                    |
| **422 Unprocessable Entity**        | Body shape from Shortcuts        | Use **Text** for phone, not **Numbers**; ensure `body` is message text |
| **400 SMS body is required**        | Empty message text               | Map `body` to Shortcut Input via **Get Text from Input**               |
| SMS missing in Inbox                | Old app build or sync delay      | Pull to refresh; confirm curl returns 200 first                        |
| **Open in Messages** disabled       | Sender phone not forwarded       | Re-import shortcut; add **Get Details of Messages → Phone Number** manually if needed |
| Reply opens Messages without recipient | Placeholder sender phone stored | Re-import latest shortcut; old messages keep placeholder until re-forwarded |


## Reply flow in the app

1. SMS appears in **Inbox** with an **SMS** tag.
2. Tap **Reply** — Albert loads the text and shows a draft.
3. Tap **Open in Messages** — iOS opens Messages with the draft filled in (when sender phone is known).
4. Review and tap **Send** on your phone.

## API


| Method | Path                        | Auth                 |
| ------ | --------------------------- | -------------------- |
| GET    | `/api/v1/me/sms-forwarding` | JWT (app session)    |
| POST   | `/api/v1/inbox/sms`         | Header `X-Sms-Token` |
