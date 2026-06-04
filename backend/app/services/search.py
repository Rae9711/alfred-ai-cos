"""Unified search across messages and commitments.

Backed by Postgres full-text search with a GIN index in production; falls back
to ILIKE on SQLite (test DB) so the same code path drives both. Results from
both entity types are merged and ranked by:

  1) text match strength (Postgres ts_rank or substring presence on SQLite),
  2) recency (newer wins ties),
  3) status (open commitments + recent messages outrank dismissed/old).

The endpoint accepts:
  - q: the query string (required, ≥2 chars)
  - kinds: optional list filter ("message", "commitment")
  - limit: capped at 50 per call

The result schema is intentionally a single discriminated-union list so the
mobile app renders one screen, not two separate hits.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Literal

from sqlalchemy import case, func, or_, select
from sqlalchemy.orm import Session

from app.db.models import Commitment, Message

ResultKind = Literal["message", "commitment"]


@dataclass
class SearchHit:
    """One unified result. The mobile UI dispatches on `kind` to choose the row."""

    kind: ResultKind
    id: str
    title: str  # subject for message, description for commitment
    snippet: str  # body_summary/snippet for message, evidence for commitment
    sender: str | None  # counterparty / sender, if any
    when: datetime | None  # sent_at / created_at
    score: float  # for client-side debugging; not authoritative


_LIMIT_MAX = 50
_MIN_QUERY_LEN = 2


def _is_postgres(db: Session) -> bool:
    """Detect dialect so we can pick the right query shape. The fallback is
    ILIKE — slow on big tables, but correct on SQLite (tests) and acceptable
    for small inboxes during early adoption."""
    bind = db.get_bind()
    return bind.dialect.name == "postgresql"


def _build_postgres_query(
    db: Session, user_id: str, q: str, kinds: set[ResultKind], limit: int
) -> list[SearchHit]:
    """Postgres path: ts_rank on a stable per-row tsvector built inline. We
    don't require a stored tsvector column because building it on the fly is
    cheap for the inbox sizes the slice targets; a GIN index can be added in a
    follow-up migration if needed."""
    ts_query = func.websearch_to_tsquery("english", q)
    hits: list[SearchHit] = []

    if "message" in kinds:
        msg_doc = func.to_tsvector(
            "english",
            func.coalesce(Message.subject, "")
            + " "
            + func.coalesce(Message.snippet, "")
            + " "
            + func.coalesce(Message.body_summary, "")
            + " "
            + func.coalesce(Message.sender, ""),
        )
        msg_rank = func.ts_rank(msg_doc, ts_query)
        rows = db.execute(
            select(Message, msg_rank.label("rank"))
            .where(Message.user_id == user_id, msg_doc.op("@@")(ts_query))
            .order_by(msg_rank.desc(), Message.sent_at.desc().nulls_last())
            .limit(limit)
        ).all()
        for msg, rank in rows:
            hits.append(_msg_hit(msg, float(rank or 0.0)))

    if "commitment" in kinds:
        c_doc = func.to_tsvector(
            "english",
            func.coalesce(Commitment.description, "")
            + " "
            + func.coalesce(Commitment.evidence, "")
            + " "
            + func.coalesce(Commitment.counterparty, ""),
        )
        c_rank = func.ts_rank(c_doc, ts_query)
        # Boost open commitments over dismissed ones — a finished item matters
        # less than an open one even if the text matches better.
        open_boost = case((Commitment.status == "open", 0.15), else_=0.0)
        rows = db.execute(
            select(Commitment, (c_rank + open_boost).label("rank"))
            .where(Commitment.user_id == user_id, c_doc.op("@@")(ts_query))
            .order_by((c_rank + open_boost).desc(), Commitment.created_at.desc())
            .limit(limit)
        ).all()
        for c, rank in rows:
            hits.append(_commit_hit(c, float(rank or 0.0)))

    hits.sort(key=lambda h: (-h.score, -(h.when or datetime.min.replace(tzinfo=UTC)).timestamp()))
    return hits[:limit]


def _build_sqlite_query(
    db: Session, user_id: str, q: str, kinds: set[ResultKind], limit: int
) -> list[SearchHit]:
    """SQLite path: ILIKE over the same set of columns. Tokenized: every space-
    separated token must appear somewhere across the searchable columns. Scoring
    is term-count-based so multi-word queries surface the right rows even on the
    fallback engine."""
    terms = [t for t in q.lower().split() if t]
    if not terms:
        return []

    hits: list[SearchHit] = []

    if "message" in kinds:
        msg_cols = [Message.subject, Message.snippet, Message.body_summary, Message.sender]
        clauses = []
        for term in terms:
            pat = f"%{term}%"
            clauses.append(or_(*[func.lower(col).like(pat) for col in msg_cols]))
        rows = db.scalars(
            select(Message)
            .where(Message.user_id == user_id, *clauses)
            .order_by(Message.sent_at.desc().nulls_last())
            .limit(limit)
        )
        for msg in rows:
            blob = " ".join(
                [msg.subject or "", msg.snippet or "", msg.body_summary or "", msg.sender or ""]
            ).lower()
            score = sum(blob.count(t) for t in terms) / max(1, len(blob.split()))
            hits.append(_msg_hit(msg, score))

    if "commitment" in kinds:
        c_cols = [Commitment.description, Commitment.evidence, Commitment.counterparty]
        clauses = []
        for term in terms:
            pat = f"%{term}%"
            clauses.append(or_(*[func.lower(col).like(pat) for col in c_cols]))
        rows = db.scalars(
            select(Commitment)
            .where(Commitment.user_id == user_id, *clauses)
            .order_by(Commitment.created_at.desc())
            .limit(limit)
        )
        for c in rows:
            blob = " ".join([c.description or "", c.evidence or "", c.counterparty or ""]).lower()
            score = sum(blob.count(t) for t in terms) / max(1, len(blob.split()))
            if c.status == "open":
                score += 0.15
            hits.append(_commit_hit(c, score))

    hits.sort(key=lambda h: (-h.score, -(h.when or datetime.min.replace(tzinfo=UTC)).timestamp()))
    return hits[:limit]


def search(
    db: Session,
    user_id: str,
    *,
    q: str,
    kinds: set[ResultKind] | None = None,
    limit: int = 20,
) -> list[SearchHit]:
    """Top-level entry point. Validates the query, picks the dialect-appropriate
    backend, returns at most `limit` hits ordered by relevance + recency."""
    q = (q or "").strip()
    if len(q) < _MIN_QUERY_LEN:
        return []
    limit = max(1, min(limit, _LIMIT_MAX))
    kinds = kinds or {"message", "commitment"}

    if _is_postgres(db):
        return _build_postgres_query(db, user_id, q, kinds, limit)
    return _build_sqlite_query(db, user_id, q, kinds, limit)


def _msg_hit(msg: Message, score: float) -> SearchHit:
    return SearchHit(
        kind="message",
        id=msg.id,
        title=msg.subject or "(no subject)",
        snippet=(msg.snippet or msg.body_summary or "")[:240],
        sender=msg.sender,
        when=msg.sent_at,
        score=score,
    )


def _commit_hit(c: Commitment, score: float) -> SearchHit:
    return SearchHit(
        kind="commitment",
        id=c.id,
        title=c.description,
        snippet=(c.evidence or c.reason or "")[:240],
        sender=c.counterparty,
        when=c.created_at,
        score=score,
    )
