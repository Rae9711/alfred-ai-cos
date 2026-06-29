# SMS forwarding (iOS Shortcut)

Albert can treat forwarded SMS like email: classify, draft a reply, then open the
system **Messages** app with the recipient and body pre-filled. You tap **Send**
from your personal number.

Email/Gmail sync is unchanged. SMS uses a separate webhook.

**Scope:** iOS can only forward **new incoming** texts via automation. Older
messages already on your phone are not synced automatically.

## Setup in Albert

1. Open **You** (settings).
2. Under **SMS forwarding**, copy:
   - **Webhook URL** — `https://alfredaitech.com/api/v1/inbox/sms`
   - **X-Sms-Token** — your personal secret (never share publicly).

## User flow (new messages only)

1. **You** → **SMS forwarding** → **Install forward shortcut** (Albert SMS Forward).
2. Paste **X-Sms-Token** when prompted.
3. Verify the shortcut (see [Verify shortcut](#verify-shortcut) below).
4. Create automation: **Settings** → **Shortcuts** → **Automation** → **+** →
   **When I receive a message** → **Run Immediately** → **Albert SMS Forward**.
   Leave message filters empty — extra filters (especially spaces) can break
   Chinese SMS.
5. Test: send yourself a text → **Inbox** → **SMS** → pull to refresh.
6. Optional: run **Albert SMS Forward** manually in Shortcuts — a JSON response
   with `message_id` means the webhook is working.

## iOS Shortcuts (recommended)

Albert ships a **signed** shortcut file. iOS rejects unsigned `.shortcut` downloads
with *Importing unsigned shortcut files is not supported* — always use the link
from Albert settings or the signed URL below.

The shortcut uses widely-supported actions (`Get Text from Input`, `Dictionary`,
`Get Contents of URL`). It does **not** use *Get Details of Content Item* /
`contentitemproperties` — those action IDs vary by iOS version and often show as
*Unknown Action* blocks.

### Albert SMS Forward (automation)

**If you already imported an older Albert SMS Forward shortcut**, delete it first
(**Shortcuts** → **Albert SMS Forward** → **…** → **Delete Shortcut**), then
install again.

1. Open **You** → **SMS forwarding**.
2. Tap **Install forward shortcut** (opens the signed download in Safari; tap
   **Add Shortcut**).
3. When prompted, paste your **X-Sms-Token** from the same screen.
4. Create the automation: **When I receive a message** → **Run Immediately** →
   **Albert SMS Forward** (no extra filters).

Signed download:

`https://alfredaitech.com/api/v1/integrations/ios/Albert-SMS-Forward.shortcut`

### Verify shortcut

After import, open **Shortcuts → Albert SMS Forward** and confirm:

| Check | Expected |
| ----- | -------- |
| **Dictionary** action | Three keys: `body`, `text`, `shortcut_input` — each mapped to **Shortcut Input** |
| **Get Contents of URL** | Method **POST**, request body **JSON**, URL `…/inbox/sms` |
| Headers | **Content-Type** `application/json` and **X-Sms-Token** with your token |

The forward shortcut maps **Shortcut Input** (the incoming message from the
automation trigger) into the JSON body. Sender phone is not included
(Message Received does not expose it reliably on all iOS versions) — **Open in
Messages** may show a toast instead of pre-filling the recipient unless you add
**Get Details of Messages** manually (advanced).

### Forward shortcut actions

| Step       | Action ID                         | Purpose                                      |
| ---------- | --------------------------------- | -------------------------------------------- |
| 1 (import) | `is.workflow.actions.gettext`     | Prompt for X-Sms-Token                       |
| 2          | `is.workflow.actions.dictionary`  | JSON payload (`body`, `text`, `shortcut_input` → Shortcut Input) |
| 3          | `is.workflow.actions.downloadurl` | POST to Albert webhook                       |

### iOS automation: empty Shortcut Input

On some iOS versions the **Message Received** trigger passes an empty Shortcut Input.
If Albert returns **400 SMS body is required**, try:

1. Delete the old shortcut and automation; re-import from **You → SMS forwarding**.
2. Automation: **When I receive a message** → **Run Immediately** (no confirmation).
3. Ensure the automation runs **Albert SMS Forward** (not a duplicate/old name).
4. Send yourself a test text; confirm curl works first (see below).

### Manual build (maintainers)

From a Mac with the `shortcuts` CLI:

```bash
python3 backend/scripts/build_sms_shortcut.py
```

Commit or ship the forward file under `backend/integrations/ios/` before deploying:

- `Albert-SMS-Forward.shortcut`

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

| Symptom                                                | Likely cause                            | Fix                                                                       |
| ------------------------------------------------------ | --------------------------------------- | ------------------------------------------------------------------------- |
| **Unknown Action** blocks                              | Old shortcut or `contentitemproperties` | Delete shortcut, re-import from Albert settings (~20+ KB signed file).    |
| **The shortcut URL provided was invalid**              | `shortcuts://` from in-app Linking      | Tap install button again (opens HTTPS in Safari).                         |
| **Importing unsigned shortcut files is not supported** | Unsigned server build                   | Maintainer: `python3 backend/scripts/build_sms_shortcut.py` and redeploy. |
| **401 Missing/Invalid X-Sms-Token**                    | Wrong or missing header                 | Copy token again from Albert → You → SMS forwarding                       |
| **422 Unprocessable Entity**                           | Body shape from Shortcuts               | Use **Text** for phone; ensure `body` is message text                     |
| **Dictionary shows only *Add New Item***               | ActionOutput refs stripped on import    | Delete shortcut, re-import signed Forward from Albert settings; Dictionary must show 3 keys. |
| SMS missing in Inbox                                   | Sync delay                              | Pull to refresh; confirm curl returns 200 first                           |
| Reply opens Messages without recipient                 | No sender phone from Shortcut           | Expected if Get Details fails; add **Get Details of Messages** manually   |

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
| GET    | `/api/v1/integrations/ios/Albert-SMS-Forward.shortcut`  | none (signed file)   |
| POST   | `/api/v1/inbox/sms`                                     | Header `X-Sms-Token` |

## Appendix: one-off import via Share (optional)

iOS does not support bulk-sync of older texts. If you need a **single** past message
in Albert, you can share it from Messages → **Share** → **Albert SMS Share** (if
installed). This is manual, per message, and not part of the main setup flow.

Screenshots for automation setup may be added under `docs/integrations/images/`.
