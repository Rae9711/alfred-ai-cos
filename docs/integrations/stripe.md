# Stripe payments

Albert can charge a payment method through Stripe. This is a level-4 (financial)
capability: it runs only after explicit approval, a strong second confirmation, and a
spend-limit check. By default it operates in **test mode** and refuses to move real money.

## What is built

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
