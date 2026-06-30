"""Aggregates all v1 routers under /api/v1."""

from fastapi import APIRouter

from app.api.v1 import (
    actions,
    assistant,
    auth,
    billing,
    briefings,
    capture,
    commitments,
    dev,
    drafts,
    inbox,
    me,
    meetings,
    messages,
    notifications,
    search,
    senders,
    schedule_proposals,
    sync,
    tasks,
    today,
    waiting,
)
from app.api.v1 import integrations as integrations_mod

api_router = APIRouter(prefix="/api/v1")
api_router.include_router(auth.router)
api_router.include_router(assistant.router)
api_router.include_router(sync.router)
api_router.include_router(today.router)
api_router.include_router(schedule_proposals.router)
api_router.include_router(commitments.router)
api_router.include_router(drafts.router)
api_router.include_router(actions.router)
api_router.include_router(meetings.router)
api_router.include_router(messages.router)
api_router.include_router(briefings.router)
api_router.include_router(tasks.router)
api_router.include_router(capture.router)
api_router.include_router(waiting.router)
api_router.include_router(me.router)
api_router.include_router(billing.router)
api_router.include_router(notifications.router)
api_router.include_router(inbox.router)
api_router.include_router(integrations_mod.router)
api_router.include_router(search.router)
api_router.include_router(senders.router)
api_router.include_router(dev.router)
