# Refused integrations

Two capabilities in the PRD's long-term vision are deliberately not built. They are not
deferred for time; they have no compliant path, so building them would mean shipping
something that breaks the trust model or gets the product shut down. The capability seam
exists for both (registered providers that raise `NotImplementedError` with the reason),
so the boundary is explicit in code rather than a silent gap.

## Browser automation (`browser_action`)

**Refused.** Driving a logged-in browser session on the user's behalf, to "book" or
"order" on sites without an API, means storing or proxying the user's credentials to
third-party sites. That directly contradicts Albert's security posture: OAuth-only,
minimal scopes, no raw credentials (see SECURITY.md). PRD risk 5 says it outright: "avoid
relying on fragile automation." A scraped, credential-replaying browser bot is fragile,
unsafe, and a standing liability.

What we do instead: integrate clean APIs (Gmail, Calendar, Stripe, WhatsApp Cloud) and
prepare actions for the user to complete, rather than impersonating them in a browser.

`app/capabilities/providers/browser_action.py` raises `NotImplementedError` pointing here.

## Food delivery ordering (`place_order` for Deliveroo / Uber Eats)

**Refused as engineering; it is business development.** There is no public partner
ordering API for Deliveroo or Uber Eats that a third party can integrate to place real
orders. The PRD parks "restaurant/grocery partner integrations" in Phase 4 precisely
because they require signed partnership deals, not code. Building a mock that pretends to
place orders would be dishonest scaffolding: it would look done and do nothing.

What we do instead: the `place_order` action type and a level-4 capability slot exist in
the framework. When a real partner API and agreement exist, a provider implements the
same `CapabilityProvider` Protocol and registers, inheriting the spend limit, strong
confirmation, and audit log automatically. Until then the provider raises
`NotImplementedError` pointing here.

`app/capabilities/providers/delivery_order.py` raises `NotImplementedError` pointing here.

## Why register stubs at all

A refused capability that is simply absent looks identical to one nobody got to yet. By
registering a provider that raises a sourced error, the refusal is a deliberate, visible
decision: anyone calling `place_order` or `browser_action` gets a clear message and a
pointer to this document, and the execution service records a blocked audit row. The seam
is ready for a real provider the day a compliant path exists, with no framework changes.
