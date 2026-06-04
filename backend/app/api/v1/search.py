"""Search endpoint (feature H).

Returns a unified list of message + commitment hits for one user. The mobile
app calls this from a single search screen with one query box.
"""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.security import get_current_user
from app.db.base import get_db
from app.db.models import User
from app.services import search as search_service

router = APIRouter(prefix="/search", tags=["search"])


class SearchHitOut(BaseModel):
    kind: Literal["message", "commitment"]
    id: str
    title: str
    snippet: str
    sender: str | None
    when: datetime | None
    score: float


class SearchOut(BaseModel):
    query: str
    results: list[SearchHitOut]


@router.get("", response_model=SearchOut)
def search(
    q: str = Query(min_length=2, max_length=200),
    limit: int = Query(default=20, ge=1, le=50),
    kind: list[Literal["message", "commitment"]] | None = Query(default=None),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> SearchOut:
    """Search the user's messages and commitments. Min 2 chars, capped at 50
    hits per call. `kind=message&kind=commitment` filters the result types."""
    kinds = set(kind) if kind else None
    hits = search_service.search(db, user.id, q=q, kinds=kinds, limit=limit)
    return SearchOut(
        query=q,
        results=[
            SearchHitOut(
                kind=h.kind,
                id=h.id,
                title=h.title,
                snippet=h.snippet,
                sender=h.sender,
                when=h.when,
                score=h.score,
            )
            for h in hits
        ],
    )
