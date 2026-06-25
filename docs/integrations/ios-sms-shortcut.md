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

## iOS Shortcut (outline)

Create an automation in the **Shortcuts** app:

1. **Trigger:** *When I receive a message* (or a personal automation you confirm).
2. Build JSON with:
   - `from_number` — sender phone
   - `body` — message text
   - `from_name` — (optional) contact name
   - `message_id` — (optional) Shortcuts UUID for dedup
3. **Get Contents of URL**
   - Method: **POST**
   - URL: webhook from settings
   - Headers: `Content-Type: application/json`, `X-Sms-Token: <your token>`
   - Request body: JSON from step 2

Example JSON body:

```json
{
  "from_number": "+15551234567",
  "body": "Can we meet tomorrow?",
  "from_name": "Alex"
}
```

## Reply flow in the app

1. SMS appears in **Inbox** with an **SMS** tag.
2. Tap **Reply** — Albert loads the text and shows a draft.
3. Tap **Open in Messages** — iOS opens Messages with the draft filled in.
4. Review and tap **Send** on your phone.

## API

| Method | Path | Auth |
|--------|------|------|
| GET | `/api/v1/me/sms-forwarding` | JWT (app session) |
| POST | `/api/v1/inbox/sms` | Header `X-Sms-Token` |
