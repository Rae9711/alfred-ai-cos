"""Typed application settings, loaded from environment. See ../../.env.example."""

from functools import lru_cache
from typing import Literal

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # App. Defaults to production so a deployment that forgets to set ENVIRONMENT
    # fails closed: dev-only endpoints (dev-session, dev seed) stay disabled.
    environment: Literal["development", "staging", "production"] = "production"
    app_base_url: str = "http://localhost:8000"
    log_level: str = "INFO"

    # Observability (Sentry). Empty DSN disables Sentry entirely (init is a no-op), so
    # dev/test never phone home. traces_sample_rate keeps perf tracing cheap by default.
    sentry_dsn: str = ""
    sentry_traces_sample_rate: float = 0.1

    # Postgres / Redis
    database_url: str
    redis_url: str

    # Auth / encryption
    jwt_secret: str
    jwt_algorithm: str = "HS256"
    jwt_expire_minutes: int = 43_200
    token_encryption_key: str
    # Comma-separated older Fernet keys, kept only so tokens encrypted with a
    # previous key still decrypt during a key rotation. New tokens are always
    # encrypted with token_encryption_key (the primary). Leave empty when not
    # rotating. See app.services.crypto and SECURITY.md ("Key rotation").
    token_encryption_key_previous: str = ""

    # Google OAuth
    google_client_id: str = ""
    google_client_secret: str = ""
    google_oauth_redirect_uri: str = "http://localhost:8000/api/v1/auth/google/callback"

    # Sign in with Apple. For native iOS SIWA this is the app's bundle ID
    # (com.haoruiwang.alfred). Empty disables POST /auth/apple (returns 503).
    apple_client_id: str = ""

    # LLM
    llm_provider: Literal["anthropic"] = "anthropic"
    anthropic_api_key: str = ""
    llm_classify_model: str = "claude-haiku-4-5"
    llm_extract_model: str = "claude-sonnet-4-6"
    llm_draft_model: str = "claude-sonnet-4-6"

    # Transcription (voice capture). Provider-agnostic; "none" disables voice and the
    # endpoint returns 501. "openai" uses the Whisper API when openai_api_key is set.
    transcription_provider: Literal["none", "openai"] = "none"
    openai_api_key: str = ""
    transcription_model: str = "whisper-1"

    # Stripe (payments). Test mode only unless allow_live_payments is explicitly true,
    # which itself requires a sk_live_ key. The provider refuses a live key otherwise.
    # See docs/integrations/stripe.md for the compliance prerequisites.
    stripe_secret_key: str = ""
    stripe_subscription_price_id: str = ""
    allow_live_payments: bool = False

    # WhatsApp Business Cloud API (sandbox). Official API only; unofficial automation
    # is refused (gets numbers banned). See docs/integrations/whatsapp.md.
    whatsapp_access_token: str = ""
    whatsapp_phone_number_id: str = ""
    # Inbound webhook auth: Meta signs each POST with the app secret (X-Hub-Signature-256)
    # and echoes verify_token on the one-time GET subscription handshake. Empty disables
    # the /inbox/whatsapp endpoint.
    whatsapp_app_secret: str = ""
    whatsapp_verify_token: str = ""

    # Forward-to-inbox: shared secret the Cloudflare Email Worker presents in
    # X-Forward-Secret. Empty disables the endpoint entirely (returns 503).
    forward_inbox_secret: str = ""

    mail_poll_interval_seconds: int = 60

    # Gmail "already handled" age cutoff. Email older than this (by sent_at) is treated
    # as already handled: not surfaced as needs-action and never generates reminders,
    # mirroring the read=handled rule. Tune here; default 30 days. Gmail/email only —
    # SMS/WhatsApp read semantics differ and are unaffected.
    email_handled_age_days: int = 30

    # Gmail sync: first connect backfills Primary inbox; later syncs use history API.
    sync_initial_max_results: int = 50
    sync_incremental_fallback_max: int = 20
    sync_unread_max_results: int = 200
    sync_recent_primary_max: int = 40
    sync_incremental_catchup_max: int = 20

    # Gmail OAuth scopes for the first slice: read inbox, create drafts. No send scope yet.
    google_scopes: list[str] = [
        "https://www.googleapis.com/auth/gmail.modify",
        "https://www.googleapis.com/auth/gmail.compose",
        # gmail.send: send email on the user's behalf (level-3 approval-gated action).
        # Adding this invalidates existing tokens — users re-consent on next sign-in.
        "https://www.googleapis.com/auth/gmail.send",
        "https://www.googleapis.com/auth/calendar.readonly",
        # calendar.events: create/update events on the user's calendar ("book my time").
        # Adding this invalidates existing tokens — users re-consent on next sign-in.
        "https://www.googleapis.com/auth/calendar.events",
        "openid",
        "email",
        "profile",
    ]


@lru_cache
def get_settings() -> Settings:
    return Settings()
