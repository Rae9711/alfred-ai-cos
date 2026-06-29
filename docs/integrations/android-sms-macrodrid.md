# SMS forwarding (Android — MacroDroid)

Albert treats forwarded SMS like email: classify, draft a reply, then open the
system **Messages** app with the recipient and body pre-filled.

**Scope:** Android cannot read SMS in the background without user automation.
MacroDroid watches SMS **notifications** and POSTs the text to Albert — same
webhook as iOS.

## Setup in Albert

1. Open **You** (settings).
2. Under **SMS forwarding**, tap **Setup guide**.
3. Copy **Webhook URL** and **X-Sms-Token** from the guide (per-user secrets).

## MacroDroid profile (recommended)

1. Install [MacroDroid](https://play.google.com/store/apps/details?id=com.arlosoft.macrodroid) and grant **Notification access**.
2. **Add Macro** → **Triggers** → **Device Events** → **Notification Posted**.
3. Select your SMS app (Google Messages, Samsung Messages, etc.).
4. **Actions** → **Connectivity** → **HTTP Request**:
   - Method: **POST**
   - URL: webhook from Albert settings
   - Headers: `Content-Type: application/json`, `X-Sms-Token: <your token>`
   - Body (JSON):

```json
{
  "body": "{notification_text}",
  "text": "{notification_text}",
  "shortcut_input": "{notification_text}"
}
```

Replace `{notification_text}` with MacroDroid's notification text variable
(e.g. `[not_text]`).

5. Save and enable the macro.
6. Test: send yourself a text → **Inbox** → **SMS** → pull to refresh.

## Manual share (optional)

Long-press a message → **Share** → **Albert**. One message at a time; sets
`backfill: true` for dedup.

Requires the Albert app build with the Android `SEND` text/plain intent filter.

## Tasker alternative

Same HTTP POST from a **Notification** profile:

- Event: **Notification Received** (owner application = your SMS app)
- Task: **HTTP Request** (POST, same URL/headers/body as above)
- Use `%ntext` or the notification text variable for the message body.

## API

| Method | Path                    | Auth                 |
| ------ | ----------------------- | -------------------- |
| GET    | `/api/v1/me/sms-forwarding` | JWT (app session) |
| POST   | `/api/v1/inbox/sms`     | Header `X-Sms-Token` |

## Troubleshooting

| Symptom | Fix |
| ------- | --- |
| **401** | Copy X-Sms-Token again from Albert → You |
| **400 SMS body is required** | Notification text variable empty — check MacroDroid trigger |
| SMS missing in Inbox | Pull to refresh; confirm HTTP 200 in MacroDroid log |
