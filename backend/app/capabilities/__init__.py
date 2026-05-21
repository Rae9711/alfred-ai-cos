"""Capability registry. Maps an ActionType to its provider. The execution service
looks providers up here; routes never touch providers directly.

Registering a capability here is the single switch that turns it on. Refused
capabilities (browser, delivery) are registered to providers that raise with a
documented reason rather than being absent, so the seam is explicit."""

from functools import lru_cache

from app.capabilities.base import CapabilityProvider
from app.db.enums import ActionType


@lru_cache
def _registry() -> dict[ActionType, CapabilityProvider]:
    from app.capabilities.providers.create_task import CreateTaskCapability
    from app.capabilities.providers.gmail_draft import GmailDraftCapability

    providers: list[CapabilityProvider] = [
        GmailDraftCapability(),
        CreateTaskCapability(),
    ]
    return {p.describe().action_type: p for p in providers}


def get_capability(action_type: ActionType) -> CapabilityProvider | None:
    return _registry().get(action_type)


def register(provider: CapabilityProvider) -> None:
    """Register a provider at runtime (used by B3/B4 to add Stripe/WhatsApp)."""
    _registry()[provider.describe().action_type] = provider
