# Stripe (subscriptions + payments)

Albert supports **Albert Pro subscriptions** (Stripe Checkout) and **one-off payments**
(`make_payment` capability). This doc covers both.

## Subscription checkout (commit ae80066)

Albert Pro subscriptions use Stripe Checkout in `subscription` mode. Plan state is read
from `user.preferences` (`subscription_plan`, `subscription_status`, etc.). Checkout is
enabled only when both env vars below are set on the server.

### Configuration

```
STRIPE_SECRET_KEY=sk_test_...           # or sk_live_ with ALLOW_LIVE_PAYMENTS=true
STRIPE_SUBSCRIPTION_PRICE_ID=price_...  # recurring Price id from Stripe Dashboard
ALLOW_LIVE_PAYMENTS=false               # never true without compliance steps below
```

Also documented in `.env.example` and `.env.production.example`.

### Stripe Dashboard setup (checklist)

1. **Products** → Create product **Albert Pro** (or reuse an existing product).
2. **Add price** → Recurring, monthly (catalog shows $12/mo; set your amount), save.
3. Copy the **Price ID** (`price_…`) → set `STRIPE_SUBSCRIPTION_PRICE_ID` in server `.env`.
4. **Developers → API keys** → copy **Secret key** → set `STRIPE_SECRET_KEY` in server `.env`.
5. Restart API after env change: `systemctl restart albert-web` (systemd) or
   `./deploy/albert-deploy.sh` (Docker on Hetzner).
6. **Webhook (recommended, not yet implemented in code):** Developers → Webhooks →
   add endpoint `https://YOUR_DOMAIN/api/v1/billing/webhook` for events
   `checkout.session.completed`, `customer.subscription.updated`,
   `customer.subscription.deleted`. Until a webhook handler ships, subscription status in
   the app stays on Free/inactive after checkout — update `user.preferences` manually or
   wait for the webhook PR.
7. **Test checkout:** open mobile **Settings → Subscription → Subscribe**. Success/cancel
   URLs are `albert://settings?billing=success|cancel`. Use Stripe test card `4242…`.

### API routes

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/v1/billing/subscription` | Current plan + `checkout_available` |
| GET | `/api/v1/billing/plans` | Catalog (Albert Pro monthly) |
| POST | `/api/v1/billing/checkout` | Body: `{ success_url, cancel_url }` → Stripe Checkout URL |

### Live billing

Same guard as payments: `sk_live_` is refused unless `ALLOW_LIVE_PAYMENTS=true`. Complete
the compliance prerequisites in the next section before enabling live keys.

---

## One-off payments (make_payment capability)

- `app/capabilities/providers/stripe_payment.py`: creates a Stripe PaymentIntent via the
  Stripe API. The only place the Stripe API is touched.
- The provider registers in the capability registry only when `STRIPE_SECRET_KEY` is set.
  Without it, `make_payment` has no provider and is blocked with an audit row.
- The execution service (`app/services/execution.py`) enforces, in order: a registered
  provider, the spend limit (`SpendLimit`), strong confirmation (HTTP 428 unless
  `confirm=true`), then execution, then an `AuditLog` row recording the amount.

## The live-money guard

The provider refuses an `sk_live_` key unless `ALLOW_LIVE_PAYMENTS=true`. This is a
deliberate two-key lock: a live key alone does nothing; you must also flip the flag. Even
then, every payment still passes through approval, strong confirmation, and the spend cap.

## Legal / compliance prerequisites (before live)

These are your responsibility, not the code's. Do not set `ALLOW_LIVE_PAYMENTS=true` until:

1. **A legal entity** that can hold a Stripe account and accept liability for charges.
2. **A Stripe account** in good standing, past KYC, with live keys issued.
3. **Terms of service and a refund/dispute policy** the user agreed to, covering
   Albert charging on their behalf.
4. **PCI scope minimized**: Albert never handles raw card numbers. The client tokenizes
   with Stripe Elements / a PaymentMethod; Albert only ever sees a `payment_method` id.
5. **A real spend-limit policy** per user, not the simple per-period cap modeled here.
   The current `SpendLimit` is a guardrail, not an accounting ledger.
6. **Mandates / SCA**: recurring or off-session charges need stored mandates and Strong
   Customer Authentication handling, which this slice does not implement.

## Configuration

```
STRIPE_SECRET_KEY=sk_test_...      # test key for development
ALLOW_LIVE_PAYMENTS=false          # never true without the steps above
```

## Payload shape

A `make_payment` proposal's `target`:

```json
{
  "amount_minor": 2500,
  "currency": "eur",
  "payment_method": "pm_card_visa",
  "description": "Invoice 1042"
}
```

`amount_minor` is in the currency's minor unit (cents). Stripe's `pm_card_visa` test
PaymentMethod works against a test key for end-to-end verification.
