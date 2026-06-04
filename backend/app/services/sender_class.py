"""Sender classification — the spam shield in front of the priority ranker.

The ranker can be brilliant about deadlines and VIPs, but if a Mailchimp
"URGENT: Your subscription expires today" leaks through as a `person` sender,
the user gets a critical-priority push for marketing. That is the failure
mode this module exists to prevent.

Classification is deterministic and runs at ingest time, so per-commitment
scoring is O(1) and the ranker can hard-floor priority for anything that
isn't a real person. Seven classes:

    person       — a real human writing personally. Eligible for any
                   priority including critical.
    role_account — info@, support@, team@, hello@. Often a real human
                   replies, but the address is shared. Capped at high.
    automated    — newsletters, transactional, notifications, marketing.
                   Capped at low. Cannot get the critical push.
    bulk         — same as automated but the message itself carries
                   bulk-mail headers (List-Unsubscribe / Precedence: bulk).
                   Treated identically to automated for scoring.
    suspicious   — display-name/domain mismatch, urgency-spam patterns,
                   blacklisted sender domains. Capped at noise.
    vip          — user has explicitly marked this sender as VIP.
                   Promoted: any score >= a threshold becomes high.
    muted        — user has explicitly muted this sender. Equivalent to
                   automated (capped at low), regardless of content.

The user can override any classification through user.preferences:
    {"sender_overrides": {"vip": ["mary@buyer.co"], "muted": ["news@x.io"]}}

VIP/muted overrides win over every other signal so the user can correct
the rare misclassification without arguing with a black-box model.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Literal

from app.db.models import Message, User

SenderClass = Literal["person", "role_account", "automated", "bulk", "suspicious", "vip", "muted"]


@dataclass
class Classification:
    """The classifier's verdict on one message.

    `cls` is the bucket. `reasons` lists the human-readable signals that drove
    the decision — surfaced in the Today screen's `reason` string so the user
    can see WHY something is or isn't shown."""

    cls: SenderClass
    reasons: list[str] = field(default_factory=list)


# --- email parsing ---

_EMAIL_RE = re.compile(r"<([^>]+)>|([\w.+-]+@[\w-]+\.[\w.-]+)")


def parse_address(raw: str) -> tuple[str, str]:
    """Split 'Mary Smith <mary@x.co>' into (display_name, email). Either side
    can be empty when the input is malformed. Email is lowercased."""
    if not raw:
        return ("", "")
    m = _EMAIL_RE.search(raw)
    email = ""
    if m:
        email = (m.group(1) or m.group(2) or "").lower()
    display = raw
    if "<" in raw:
        display = raw.split("<", 1)[0].strip().strip('"').strip()
    elif email:
        display = ""
    return (display, email)


def domain_of(email: str) -> str:
    """Return the domain portion of an email, lowercased. Empty when no @."""
    if "@" not in email:
        return ""
    return email.split("@", 1)[1].lower()


# --- role / automated patterns ---

# Local parts that strongly suggest a shared-inbox role account, not a person.
_ROLE_LOCAL_PARTS = {
    "info",
    "hello",
    "hi",
    "team",
    "support",
    "help",
    "contact",
    "admin",
    "office",
    "sales",
    "billing",
    "accounts",
    "accounting",
    "hr",
    "people",
    "careers",
    "jobs",
    "press",
    "media",
    "legal",
    "compliance",
    "privacy",
    "security",
    "abuse",
    "postmaster",
    "webmaster",
}

# Local parts that are almost always automated mailers. These can never be
# `person` regardless of content.
_AUTOMATED_LOCAL_PARTS = {
    "noreply",
    "no-reply",
    "donotreply",
    "do-not-reply",
    "notifications",
    "notification",
    "alerts",
    "alert",
    "updates",
    "update",
    "newsletter",
    "newsletters",
    "digest",
    "weekly",
    "daily",
    "mailer",
    "mailman",
    "bounces",
    "mailer-daemon",
    "marketing",
    "promo",
    "promotions",
    "campaigns",
    "deals",
    "offers",
    "news",
    "feedback",
    "reply",  # reply@<service>.com is usually a tracker
    "automated",
    "auto",
    "system",
    "robot",
    "bot",
    "transactional",
    "receipts",
    "receipt",
    "billing-noreply",
    "invitations",
    "invites",
}

# Local parts that have a digit suffix typical of mail-blast platforms:
# bounce-12345@sender.mailchimpapp.com, click@email.something.io, etc.
_AUTOMATED_LOCAL_PREFIXES = (
    "bounce",
    "bounces",
    "click",
    "open",
    "track",
    "tracking",
    "campaign",
    "blast",
    "mail-",
    "list-",
)

# Domain patterns that are bulk-mail platforms — anything sent from these is
# automated regardless of local part.
_BULK_DOMAIN_PATTERNS = (
    "mailchimp",
    "mailchimpapp",
    "mailgun",
    "mandrillapp",
    "sendgrid",
    "sendgrid.net",
    "amazonses",
    "amazon.com.dwbrmq",  # AWS bounce subdomain
    "constantcontact",
    "campaignmonitor",
    "createsend.com",
    "klaviyo",
    "klaviyomail",
    "convertkit",
    "mailerlite",
    "drip.com",
    "hubspot",
    "hsforms",
    "intercom-mail",
    "intercom.me",
    "customer.io",
    "postmarkapp",
    "mailjet",
    "smtp2go",
    "sparkpost",
    "salesforce.com",  # SFMC sends
    "salesloft",
    "outreach.io",
    "apollo.io",
    "lemlist",
    "substack.com",
    "convertkit-mail",
    "mailpoet.com",
    "tinyletter",
    "groovehq",
)

# Common bulk-mail subdomain prefixes: e.g. email.notion.com, news.airbnb.com,
# updates.github.com. These often deliver legitimate transactional mail too,
# so this knocks the class down to automated rather than spam.
_TRANSACTIONAL_SUBDOMAINS = (
    "email.",
    "news.",
    "newsletter.",
    "marketing.",
    "promo.",
    "offers.",
    "info.",
    "mail.",
    "send.",
    "delivery.",
    "deliver.",
    "smtp.",
    "notify.",
    "notifications.",
    "alerts.",
    "messages.",
)

# Free-mail providers that DO host real people. Used to skip the "no first.last
# pattern → role account" guess for personal Gmail/Yahoo/etc.
_FREE_MAIL_DOMAINS = {
    "gmail.com",
    "googlemail.com",
    "yahoo.com",
    "yahoo.co.uk",
    "yahoo.fr",
    "hotmail.com",
    "outlook.com",
    "live.com",
    "icloud.com",
    "me.com",
    "mac.com",
    "protonmail.com",
    "proton.me",
    "fastmail.com",
    "gmx.com",
    "aol.com",
    "qq.com",
    "163.com",
    "126.com",
    "yandex.com",
}

# Domains that have been documented to act as launchpads for phishing or
# extreme low-trust outreach. Anything from these is `suspicious` unless the
# user has VIP-ed it.
_SUSPICIOUS_DOMAINS = {
    "sendinblue.com",  # legitimate bulk + frequently abused
    "tutanota.com",  # often used for cold outreach
    "mail.ru",
    "yandex.ru",
}


# --- header signals ---


def _has_bulk_headers(headers: dict | None) -> tuple[bool, list[str]]:
    """Return (is_bulk, reasons). Bulk = the message itself ANNOUNCES it's bulk
    mail via standard headers. RFC 2076 + Microsoft conventions covered."""
    if not headers:
        return (False, [])
    h = {k.lower(): str(v) for k, v in headers.items()}
    found: list[str] = []
    if h.get("list-unsubscribe"):
        found.append("List-Unsubscribe header present")
    precedence = h.get("precedence", "").lower()
    if precedence in {"bulk", "junk", "list"}:
        found.append(f"Precedence: {precedence}")
    auto_submitted = h.get("auto-submitted", "").lower()
    if auto_submitted and auto_submitted != "no":
        found.append(f"Auto-Submitted: {auto_submitted}")
    if h.get("x-auto-response-suppress"):
        found.append("X-Auto-Response-Suppress set")
    if h.get("feedback-id"):
        found.append("Feedback-ID set (bulk delivery report)")
    if h.get("x-mailchimp-id") or h.get("x-mc-user"):
        found.append("Mailchimp delivery")
    if h.get("x-sg-eid") or h.get("x-sendgrid-id"):
        found.append("SendGrid delivery")
    if h.get("x-campaign") or h.get("x-campaign-id"):
        found.append("Campaign header")
    return (bool(found), found)


# --- subject heuristics ---

_URGENCY_SPAM_RE = re.compile(
    r"\b(ACT NOW|LIMITED TIME|FINAL NOTICE|DON'?T MISS|LAST CHANCE|"
    r"CLAIM (YOUR|NOW)|FREE|CONGRATULATIONS|YOU'?VE WON|WINNER|"
    r"VERIFY (YOUR|YOU)|SUSPEND(ED)?|UNUSUAL ACTIVITY|"
    r"UNUSUAL SIGN-?IN|CLICK HERE|EXCLUSIVE OFFER)\b",
    re.IGNORECASE,
)

_NEWSLETTER_SUBJECT_RE = re.compile(
    # Matches several common newsletter / digest subject shapes:
    #   [Anything Newsletter] Whatever
    #   [Anything Digest] Whatever
    #   [Brand] Digest — June 4
    #   Your weekly digest from X
    #   The Daily Brief
    #   Issue #42 of the Brand
    r"(^\s*\[[^\]]*\]\s+(digest|newsletter|brief|recap|round[- ]?up)\b|"
    r"\[[^\]]*(newsletter|digest)\]|"
    r"your (weekly|daily|monthly|biweekly) (digest|update|recap|brief)|"
    r"this week (in|at)|weekly (round-?up|brief)|"
    r"the (daily|weekly|morning|evening) (brief|digest)|"
    r"^issue #?\d+|"
    r"^\s*(newsletter|digest):)",
    re.IGNORECASE,
)

# Subjects that scream "transactional, not a person": receipts, account
# notifications, security alerts.
_TRANSACTIONAL_SUBJECT_RE = re.compile(
    r"\b(your (order|receipt|invoice|statement|subscription)|"
    r"order #?\d+|receipt #?\d+|payment (received|confirmed|failed)|"
    r"your (login|sign-?in|account)|new sign-?in|password (was|reset)|"
    r"welcome to|getting started with|here'?s your)\b",
    re.IGNORECASE,
)


# --- the classifier ---


@dataclass
class _Overrides:
    vip: set[str]
    muted: set[str]


def _overrides_from(user: User | None) -> _Overrides:
    """Pull per-user overrides from user.preferences. Schema:
        preferences.sender_overrides = {"vip": [...], "muted": [...]}
    Both lists hold lowercased email addresses or bare domains. A domain
    override matches everyone at that domain — useful for "always VIP
    everyone @board.co" or "always mute everyone @news.io"."""
    if user is None:
        return _Overrides(vip=set(), muted=set())
    raw = (user.preferences or {}).get("sender_overrides") or {}
    vip = {str(s).lower().strip() for s in (raw.get("vip") or []) if s}
    muted = {str(s).lower().strip() for s in (raw.get("muted") or []) if s}
    return _Overrides(vip=vip, muted=muted)


def _matches_override(email: str, overrides: set[str]) -> bool:
    """Email matches an override if it's either an exact address match or its
    domain matches a domain-only override entry."""
    if not email:
        return False
    if email in overrides:
        return True
    dom = domain_of(email)
    if not dom:
        return False
    if dom in overrides:
        return True
    # Match subdomains too: a `*.board.co` style is implied by the bare domain.
    return any(dom.endswith("." + o) for o in overrides if "." in o)


def classify(
    *,
    sender: str,
    subject: str | None,
    snippet: str | None,
    headers: dict | None,
    user: User | None = None,
) -> Classification:
    """Pure function: return a Classification given the message's surface.

    Order of decisions (intentional, the highest-confidence signals first):

    1) user override → vip / muted (always wins)
    2) suspicious patterns: display/email mismatch, scam subject, blacklist
    3) bulk headers present → bulk
    4) automated local part OR automated platform domain → automated
    5) transactional subject + transactional subdomain → automated
    6) role local part → role_account
    7) urgency-spam subject from non-VIP first-time sender → suspicious
    8) otherwise → person

    The list of reasons accumulates regardless of which branch wins so the
    surface reason can read "marked as VIP; would otherwise be a newsletter."
    """
    display, email = parse_address(sender or "")
    dom = domain_of(email)
    overrides = _overrides_from(user)
    reasons: list[str] = []

    # 1) user overrides win first.
    if _matches_override(email, overrides.muted):
        return Classification(cls="muted", reasons=["you muted this sender"])
    if _matches_override(email, overrides.vip):
        return Classification(cls="vip", reasons=["you marked this sender VIP"])

    # 2) suspicious patterns.
    susp = _suspicious_signals(display=display, email=email, subject=subject, snippet=snippet)
    if susp:
        return Classification(cls="suspicious", reasons=susp)

    # 3) bulk headers.
    is_bulk, bulk_reasons = _has_bulk_headers(headers)
    if is_bulk:
        return Classification(cls="bulk", reasons=bulk_reasons)

    # 4) automated local part or platform domain.
    local = email.split("@", 1)[0] if "@" in email else ""
    if local in _AUTOMATED_LOCAL_PARTS or any(
        local.startswith(p) for p in _AUTOMATED_LOCAL_PREFIXES
    ):
        reasons.append(f"sender local part '{local}' is an automated address")
        return Classification(cls="automated", reasons=reasons)
    if dom and any(p in dom for p in _BULK_DOMAIN_PATTERNS):
        reasons.append(f"sent through a bulk-mail platform ({dom})")
        return Classification(cls="automated", reasons=reasons)

    # 5) transactional subdomain + transactional subject = automated.
    if dom and any(dom.startswith(prefix) for prefix in _TRANSACTIONAL_SUBDOMAINS):
        if subject and _TRANSACTIONAL_SUBJECT_RE.search(subject):
            reasons.append(f"transactional subdomain + transactional subject ({dom})")
            return Classification(cls="automated", reasons=reasons)
        # A transactional subdomain without a matching subject is still suspicious
        # for ranking purposes, but downgrade only to role_account so a real
        # support reply from email.company.co doesn't get buried.
        reasons.append(f"sent from transactional subdomain ({dom})")
        return Classification(cls="role_account", reasons=reasons)

    # Newsletter / digest subjects from any sender → automated.
    if subject and _NEWSLETTER_SUBJECT_RE.search(subject):
        reasons.append("subject reads as a newsletter / digest")
        return Classification(cls="automated", reasons=reasons)

    # 6) role local part.
    if local in _ROLE_LOCAL_PARTS:
        reasons.append(f"shared-inbox local part '{local}'")
        return Classification(cls="role_account", reasons=reasons)

    # 7) urgency-spam — flagged as suspicious so the ranker hard-floors it.
    # Real people don't write subjects in all caps demanding immediate action.
    if subject and _URGENCY_SPAM_RE.search(subject):
        reasons.append("urgency-spam phrasing in the subject")
        return Classification(cls="suspicious", reasons=reasons)

    # 8) default: assumed to be a person.
    return Classification(cls="person", reasons=reasons or ["normal sender pattern"])


def _suspicious_signals(
    *, display: str, email: str, subject: str | None, snippet: str | None
) -> list[str]:
    """Return non-empty list when the message looks like phishing or scam.
    Any single signal in this list is enough to floor priority to noise — we
    err on the side of letting a real ask through with low priority rather
    than push a phishing test to the top."""
    reasons: list[str] = []
    dom = domain_of(email)

    # Explicit blacklist of platforms over-represented in cold/phishing outreach.
    if dom in _SUSPICIOUS_DOMAINS:
        reasons.append(f"sender domain {dom} is on the suspicious list")
        return reasons

    # Display-name impersonation: display claims a well-known brand but the
    # email is on a different domain.
    if display:
        brand = _impersonated_brand(display, dom)
        if brand:
            reasons.append(f"display name claims '{brand}' but the email domain is {dom}")
            return reasons

    # All-caps subject screaming for attention. A real human almost never
    # writes a subject in all caps; if 70%+ of letter characters in a long
    # enough subject are uppercase, treat as spam-style urgency.
    if subject and _is_screaming(subject):
        reasons.append("subject is all-caps / screaming")
        return reasons

    # Phishing-style snippet content: "verify your account", "click here to
    # unlock", etc., combined with a non-personal sender (any of: short local
    # part, no display name, free-mail domain pretending to be corporate).
    if snippet and _is_phishy_snippet(snippet) and (not display or dom == ""):
        reasons.append("phishing-style content from a no-name sender")
        return reasons

    return reasons


# Reduce a display name to a key, then compare against domain. A display name
# that claims "PayPal" must come from a paypal.com address; otherwise it's
# impersonation. The list is intentionally short — only obvious global brands
# people get phished about.
_IMPERSONATED_BRANDS = {
    "paypal": "paypal.com",
    "stripe": "stripe.com",
    "google": "google.com",
    "gmail": "google.com",
    "microsoft": "microsoft.com",
    "apple": "apple.com",
    "icloud": "apple.com",
    "amazon": "amazon.com",
    "facebook": "facebook.com",
    "meta": "fb.com",
    "instagram": "instagram.com",
    "twitter": "twitter.com",
    "x corp": "x.com",
    "linkedin": "linkedin.com",
    "github": "github.com",
    "dropbox": "dropbox.com",
    "docusign": "docusign.com",
    "intuit": "intuit.com",
    "irs": "irs.gov",
    "hmrc": "hmrc.gov.uk",
}


def _impersonated_brand(display: str, dom: str) -> str | None:
    """If display name claims a famous brand and the domain isn't a subdomain
    of that brand's real domain, return the brand name. Else None."""
    if not display or not dom:
        return None
    lc = display.lower()
    for brand, real_dom in _IMPERSONATED_BRANDS.items():
        if brand in lc:
            if dom == real_dom or dom.endswith("." + real_dom):
                return None  # legitimate
            return brand
    return None


def _is_screaming(subject: str) -> bool:
    """≥70% uppercase letters AND ≥8 letters AND no Re:/Fwd: prefix."""
    letters = [c for c in subject if c.isalpha()]
    if len(letters) < 8:
        return False
    if subject.lower().startswith(("re:", "fwd:", "fw:")):
        return False
    upper = sum(1 for c in letters if c.isupper())
    return (upper / len(letters)) >= 0.7


_PHISH_RE = re.compile(
    r"\b(verify your (account|identity|login)|click (here|the link) (to|now)|"
    r"unlock your account|your account (has been|will be) (locked|suspended|closed)|"
    r"confirm your (password|details)|update your (payment|billing) (info|details)|"
    r"wire (this|the) (funds|payment)|unusual sign-?in|"
    r"action required (today|now|immediately))",
    re.IGNORECASE,
)


def _is_phishy_snippet(snippet: str) -> bool:
    return bool(_PHISH_RE.search(snippet))


# --- attach to a Message ---


def classify_message(message: Message, *, user: User | None) -> Classification:
    """Classify a Message using its stored fields. Convenience wrapper for the
    ingestion pipeline so it doesn't unpack the message dict by hand."""
    return classify(
        sender=message.sender or "",
        subject=message.subject,
        snippet=message.snippet,
        headers=message.headers,
        user=user,
    )


# --- API for the ranker ---

# The hard floor applied to each class. A message classified as automated
# can NEVER produce a critical-priority push, no matter how many keywords
# its content matches. The user can always promote by marking the sender VIP.
PRIORITY_CEILING_FOR_CLASS: dict[SenderClass, str] = {
    "vip": "critical",  # VIPs can hit critical
    "person": "critical",  # everyone else who's a person too
    "role_account": "high",  # shared inboxes cap at high
    "automated": "low",  # mailers can't push you
    "bulk": "low",
    "muted": "low",  # muted overrides treat like automated
    "suspicious": "noise",  # phishing / impersonation never surfaces
}


def backfill_classifications(db, *, user_id: str | None = None, batch_size: int = 500) -> int:
    """One-shot backfill that classifies every Message with a null
    sender_classification. Runs after the migration adds the column so existing
    rows pick up the shield without a re-ingest.

    Safe to call repeatedly: only NULL rows are touched. Returns the number of
    messages classified."""
    from sqlalchemy import select  # local import: keeps `sender_class` framework-free

    from app.db.models import Message, User

    classified = 0
    while True:
        stmt = select(Message).where(Message.sender_classification.is_(None)).limit(batch_size)
        if user_id is not None:
            stmt = stmt.where(Message.user_id == user_id)
        batch = list(db.scalars(stmt))
        if not batch:
            break
        # Cache users per batch so we don't refetch the same user for every row.
        users: dict[str, User | None] = {}
        for m in batch:
            user = users.get(m.user_id)
            if user is None and m.user_id not in users:
                user = db.get(User, m.user_id)
                users[m.user_id] = user
            cls = classify(
                sender=m.sender or "",
                subject=m.subject,
                snippet=m.snippet,
                headers=m.headers,
                user=user,
            )
            m.sender_classification = cls.cls
            classified += 1
        db.commit()
    return classified


# Score multipliers applied to the additive bonuses inside the ranker. Even
# before the hard ceiling we shrink the bonus stack for non-person classes
# so a bulk message can't reach the score that would otherwise put it at
# medium even if all rules fire.
SCORE_MULTIPLIER_FOR_CLASS: dict[SenderClass, float] = {
    "vip": 1.15,  # mild lift for VIPs
    "person": 1.0,
    "role_account": 0.85,
    "automated": 0.45,
    "bulk": 0.40,
    "muted": 0.20,
    "suspicious": 0.0,  # zero out — only the constant urgency reason shows
}
