// Cloudflare Email Worker for forward@in.alfredassistants.com.
//
// Inbound mail is delivered as a ReadableStream of raw RFC822. We parse it with
// postal-mime (a tiny dependency that handles MIME + character encoding without
// pulling in Node libraries that don't run in Workers), then POST a clean JSON
// payload to Albert's webhook. The webhook auths on a shared secret.
//
// Deploy:
//   cd deploy/cloudflare-email-worker
//   bunx wrangler deploy
//   bunx wrangler secret put FORWARD_INBOX_SECRET   # paste the value from /opt/albert/.env
//
// Bind: in Cloudflare dashboard → Email Routing → Routing Rules, add a custom
// address `forward@in.alfredassistants.com` with action "Send to a Worker" →
// this Worker.

import PostalMime from "postal-mime";

const ALBERT_ENDPOINT = "https://albert.alfredassistants.com/api/v1/inbox/forward";

export default {
  async email(message, env) {
    if (!env.FORWARD_INBOX_SECRET) {
      console.error("FORWARD_INBOX_SECRET not set — refusing to forward");
      message.setReject("Internal configuration error");
      return;
    }

    let parsed;
    try {
      parsed = await PostalMime.parse(message.raw);
    } catch (err) {
      console.error("Failed to parse inbound email", err);
      message.setReject("Could not parse message");
      return;
    }

    const forwarder = parsed.from?.address || message.from;
    if (!forwarder) {
      message.setReject("Missing sender");
      return;
    }

    const payload = {
      forwarder,
      subject: parsed.subject || null,
      // Prefer plain text; fall back to a stripped-HTML version so quoted-printable
      // forwards still work. Trim absurdly large bodies — extraction doesn't need
      // 50MB of nested-reply history.
      body: (parsed.text || stripHtml(parsed.html || "") || "").slice(0, 200_000),
      original_message_id: parsed.messageId || null,
      received_at: new Date().toISOString(),
    };

    const resp = await fetch(ALBERT_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Forward-Secret": env.FORWARD_INBOX_SECRET,
      },
      body: JSON.stringify(payload),
    });

    if (resp.status === 404) {
      // Forwarder isn't a registered Albert user. Drop silently — bouncing would
      // leak that this address is special.
      console.log(`Dropping forward from non-user ${forwarder}`);
      return;
    }

    if (!resp.ok) {
      const text = await resp.text();
      console.error(`Webhook ${resp.status}: ${text}`);
      message.setReject(`Albert webhook returned ${resp.status}`);
      return;
    }

    console.log(`Forwarded ${forwarder} → ${ALBERT_ENDPOINT}`);
  },
};

function stripHtml(html) {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
