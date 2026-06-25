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

    # Postgres / Redis
    database_url: str
    redis_url: str

    # Auth / encryption
    jwt_secret: str
    jwt_algorithm: str = "HS256"
    jwt_expire_minutes: int = 43_200
    token_encryption_key: str

    # Google OAuth
    google_client_id: str = ""
    google_client_secret: str = ""
    google_oauth_redirect_uri: str = "http://localhost:8000/api/v1/auth/google/callback"

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
    allow_live_payments: bool = False

    # WhatsApp Business Cloud API (sandbox). Official API only; unofficial automation
    # is refused (gets numbers banned). See docs/integrations/whatsapp.md.
    whatsapp_access_token: str = ""
    whatsapp_phone_number_id: str = ""

    # Forward-to-inbox: shared secret the Cloudflare Email Worker presents in
    # X-Forward-Secret. Empty disables the endpoint entirely (returns 503).
    forward_inbox_secret: str = ""

    mail_poll_interval_seconds: int = 60

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
