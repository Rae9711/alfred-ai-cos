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

### One-tap install (easiest)

1. Open **You** → **SMS forwarding**.
2. Tap **Install shortcut** (opens Shortcuts via `shortcuts://import-shortcut`).
3. When prompted, paste your **X-Sms-Token** from the same screen.
4. Create the automation: **When I receive a message** → run **Albert SMS Forward**
   immediately.

Direct download (Safari):  
`https://alfredaitech.com/api/v1/integrations/ios/Albert-SMS-Forward.shortcut`  
A signed file is ~23 KB; if the download is only ~2 KB, the server is serving an
unsigned build — contact support or retry after a redeploy.

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
2. **Find Messages** where *Is from the sender* is *Shortcut Input* (the incoming message).
3. **Get Details of Messages** → **Sender** (or **Phone Number** if Sender is empty).
  - Prefer **Text** from Get Details, not the **Numbers** magic variable (Numbers often
   arrives as a JSON array and can cause 422 errors on older app builds).
4. **Dictionary** with keys:
  - `from_number` → Sender / Phone Number text from step 3
  - `body` → Shortcut Input (the message text)
  - `from_name` → (optional) contact name if you have it
5. **Get Contents of URL**
  - Method: **POST**
  - URL: webhook from Albert settings
  - Headers:
    - `Content-Type: application/json`
    - `X-Sms-Token: <your token>`
  - Request body: **File** → the Dictionary from step 4 (Shortcuts serializes it as JSON)

### Without the Sender magic variable

If your iOS version does not expose *Sender* on the automation trigger, use Find Messages +
Get Details as above. Do **not** wire the **Numbers** variable directly unless you must —
it is often sent as `[15551234567]` instead of a string.

Example JSON body (what Albert expects after coercion):

```json
{
  "from_number": "+15551234567",
  "body": "Can we meet tomorrow?",
  "from_name": "Alex"
}
```

Albert also accepts aliases: `fromNumber`, `phone`, `sender_phone`, `sender` for the phone
and `text`, `message`, `content` for the body.

## Test with curl

Replace `YOUR_TOKEN` with the token from Albert settings:

```bash
curl -sS -X POST 'https://alfredaitech.com/api/v1/inbox/sms' \
  -H 'Content-Type: application/json' \
  -H 'X-Sms-Token: YOUR_TOKEN' \
  -d '{"from_number":"+15551234567","body":"curl test message"}'
```

Success looks like:

```json
{"message_id":"...","commitments_extracted":0,"deduped":false,"draft_created":true}
```

## Troubleshooting


| Symptom                             | Likely cause                     | Fix                                                                    |
| ----------------------------------- | -------------------------------- | ---------------------------------------------------------------------- |
| **Importing unsigned shortcut files is not supported** | Unsigned `.shortcut` from server | Use **Install shortcut** in Albert → You, or the signed URL (~23 KB). Maintainer: run `python3 backend/scripts/build_sms_shortcut.py` and redeploy. |
| **401 Missing/Invalid X-Sms-Token** | Wrong or missing header          | Copy token again from Albert → You → SMS forwarding                    |
| **422 Unprocessable Entity**        | Body shape from Shortcuts        | Use **Text** for phone, not **Numbers**; ensure `body` is message text |
| **400 Invalid sender phone number** | Empty or non-phone `from_number` | Check Get Details → Sender / Phone Number is populated                 |
| **400 SMS body is required**        | Empty message text               | Map `body` to Shortcut Input, not a blank variable                     |
| SMS missing in Inbox                | Old app build or sync delay      | Pull to refresh; confirm curl returns 200 first                        |


## Reply flow in the app

1. SMS appears in **Inbox** with an **SMS** tag.
2. Tap **Reply** — Albert loads the text and shows a draft.
3. Tap **Open in Messages** — iOS opens Messages with the draft filled in.
4. Review and tap **Send** on your phone.

## API


| Method | Path                        | Auth                 |
| ------ | --------------------------- | -------------------- |
| GET    | `/api/v1/me/sms-forwarding` | JWT (app session)    |
| POST   | `/api/v1/inbox/sms`         | Header `X-Sms-Token` |


