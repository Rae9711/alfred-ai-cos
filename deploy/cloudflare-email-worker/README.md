# Albert forward-to-inbox: Cloudflare Email Worker

Forward any email to `forward@in.alfredassistants.com` and it lands in your
Albert inbox, gets classified, and surfaces commitments through the same
ranker as your real Gmail.

This directory holds the Cloudflare Worker that bridges Cloudflare Email
Routing to Albert's `/api/v1/inbox/forward` webhook.

## One-time setup (you need to do this once)

### 1. Generate the shared secret

```
openssl rand -hex 32
```

Save the output. You'll paste it into two places: Albert's `.env` and the
Worker's secret.

### 2. Add the secret to Albert on the VPS

```
ssh root@89.167.84.193
echo "FORWARD_INBOX_SECRET=<paste>" >> /opt/albert/.env
systemctl restart albert-web
```

(After this, the webhook returns 401 on a wrong secret and 503 with no secret.)

### 3. Add MX records for `in.alfredassistants.com`

In Cloudflare → DNS → Records for `alfredassistants.com`, add:

```
Type    Name                Content                        Priority
MX      in                  route1.mx.cloudflare.net       1
MX      in                  route2.mx.cloudflare.net       2
MX      in                  route3.mx.cloudflare.net       3
TXT     in                  "v=spf1 include:_spf.mx.cloudflare.net ~all"
```

(Cloudflare's actual MX endpoints are what they're using as of this writing —
verify in their Email Routing setup wizard if they've moved.)

### 4. Enable Email Routing on the subdomain

In Cloudflare → Email → Email Routing:
- Add a custom domain: `in.alfredassistants.com`
- Cloudflare verifies the MX records you just added
- Add a routing rule: custom address `forward@in.alfredassistants.com` →
  action "Send to a Worker" → (you'll set this in step 6)

### 5. Deploy the Worker

```
cd deploy/cloudflare-email-worker
bun install
bunx wrangler login          # one-time, opens browser
bunx wrangler deploy
bunx wrangler secret put FORWARD_INBOX_SECRET
# paste the same value you set in /opt/albert/.env
```

### 6. Point the routing rule at the Worker

Back in Email Routing → Routing Rules → edit the `forward@…` rule, pick the
deployed `albert-email-worker` Worker.

## Verify

Forward any email from your registered Albert address to
`forward@in.alfredassistants.com`. Within a few seconds it should show up in
your Albert Today / Inbox. The worker logs (`bunx wrangler tail`) will show
the POST.

If it doesn't land:
- `journalctl -u albert-web -n 50` on the VPS — look for `/api/v1/inbox/forward` calls.
- `bunx wrangler tail` — look for the email Worker's logs.
- 401 means the secrets don't match.
- 503 means Albert's `.env` is missing the secret.
- 404 means your forwarding address isn't a registered Albert user (case-
  sensitive on the local part, case-insensitive on the domain).

## Security posture

- The webhook is dumb: it trusts the parsed JSON the Worker sends, gated by a
  shared secret. The Worker is the trust boundary.
- Forwards from non-registered addresses get dropped silently (no bounce, no
  hint that the address is special).
- Body size is capped at 200KB to prevent extraction from chewing through a
  giant nested forward chain.
- The Worker does not store anything; it's a stream → parse → POST pipeline.
