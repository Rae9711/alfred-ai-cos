"""Conversation import routes: parse WeChat paste → analyze → confirm actions."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.core.security import get_current_user
from app.db.base import get_db
from app.db.models import User
from app.schemas.api import (
    ConversationAnalyzeRequest,
    ConversationAnalyzeResponse,
    ConversationConfirmRequest,
    ConversationConfirmResponse,
    ConversationInboxResponse,
    ConversationParseRequest,
    ParsedConversationOut,
)
from app.services import conversation as conversation_service

router = APIRouter(prefix="/conversations", tags=["conversations"])


@router.post("/parse", response_model=ParsedConversationOut)
def parse_conversation(
    payload: ConversationParseRequest,
    user: User = Depends(get_current_user),
) -> ParsedConversationOut:
    del user  # auth only — parse is stateless and does not persist
    text = (payload.text or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="Clipboard text is empty")
    return conversation_service.parse_conversation(text)


@router.post("/analyze", response_model=ConversationAnalyzeResponse)
def analyze_conversation(
    payload: ConversationAnalyzeRequest,
    user: User = Depends(get_current_user),
) -> ConversationAnalyzeResponse:
    if not payload.conversation.messages:
        raise HTTPException(status_code=400, detail="Conversation has no messages")
    tz = payload.timezone or user.timezone or "UTC"
    return conversation_service.analyze_conversation(
        payload.conversation,
        goal=payload.goal or "custom",
        tones=payload.tones,
        user=user,
        timezone=tz,
    )


@router.post("/actions/confirm", response_model=ConversationConfirmResponse)
def confirm_conversation_action(
    payload: ConversationConfirmRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ConversationConfirmResponse:
    tz = payload.timezone or user.timezone or "UTC"
    try:
        return conversation_service.confirm_action(db, user, payload, timezone=tz)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/inbox", response_model=ConversationInboxResponse)
def conversation_inbox(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ConversationInboxResponse:
    return conversation_service.list_conversation_inbox(db, user.id)
