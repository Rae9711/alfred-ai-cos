"""Extraction Agent (PRD 14.1, agent 2) + classification (agent for PRD 12.2).

For each message it classifies the email and extracts commitments via the LLM,
then persists a Message classification and Commitment rows with evidence and
confidence. The full body is fetched from Gmail in-process and never stored,
keeping the DB free of raw email content."""

from __future__ import annotations

import re
from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.enums import CommitmentStatus, SourceType
from app.db.models import Commitment, Message, User
from app.llm import get_llm
from app.schemas.llm import ClassificationResult
from app.services import gmail
from app.services import schedule_proposal as schedule_proposal_service
from app.services.classification_adjust import (
    apply_action_subject_classification,
    automated_fyi_override,
    subject_implies_action_required,
    upgrade_human_misclassified_as_fyi,
)
from app.services.connected_accounts import get_google_account_for_message
from app.services.crypto import decrypt_token
from app.services.message_body import build_thread_summary
from app.services.inbox_view import message_user_decided

# Common filler words that carry no identity for a commitment. Two phrasings of the
# same task ("retain Premium" vs "maintain Premium") differ only in filler/synonyms,
# so keying on the distinctive content words collapses them.
_STOPWORDS = frozenset(
    {
        "the",
        "a",
        "an",
        "to",
        "for",
        "of",
        "and",
        "or",
        "in",
        "on",
        "at",
        "by",
        "your",
        "you",
        "with",
        "before",
        "after",
        "is",
        "are",
        "be",
        "this",
        "that",
        "it",
        "as",
        "retain",
        "maintain",
        "keep",
        "extend",
        "access",
        "please",
        "send",
        "make",
        "sure",
    }
)


def _dedup_key(owner: str, counterparty: str | None, description: str) -> str:
    """A normalized key for collapsing near-duplicate commitments. Keys on owner +
    counterparty + the sorted set of distinctive content words (4+ chars, not filler),
    so reworded variants of the same task ('Upload notes to Studocu to retain Premium'
    vs '...to maintain Premium') produce the same key regardless of order/synonyms."""
    words = re.findall(r"[a-z0-9]+", description.lower())
    content = sorted({w for w in words if len(w) >= 4 and w not in _STOPWORDS})
    cp = (counterparty or "").lower().strip()
    return f"{owner}|{cp}|{' '.join(content)}"


_EXTRACTION_BLOCKED_CLASSES = {"automated", "bulk", "suspicious", "muted"}


def _thread_open_commitments(db: Session, user_id: str, thread_id: str) -> list[Commitment]:
    """Open commitments whose source message belongs to this thread."""
    thread_msg_ids = set(
        db.scalars(
            select(Message.id).where(
                Message.user_id == user_id,
                Message.thread_id == thread_id,
            )
        )
    )
    if not thread_msg_ids:
        return []
    return list(
        db.scalars(
            select(Commitment).where(
                Commitment.user_id == user_id,
                Commitment.status == CommitmentStatus.open,
                Commitment.source_id.in_(thread_msg_ids),
            )
        )
    )


def _reconcile_thread_commitments(
    db: Session,
    user: User,
    message: Message,
    *,
    body: str,
    thread_summary: str,
) -> None:
    """Mark open thread commitments resolved when later messages close the loop."""
    if not message.thread_id:
        return
    open_in_thread = _thread_open_commitments(db, user.id, message.thread_id)
    if not open_in_thread:
        return

    latest = (
        f"Latest message ({message.sent_at.date() if message.sent_at else 'today'}):\n"
        f"From: {message.sender}\nSubject: {message.subject or '(none)'}\n\n{body}"
    )
    thread_context = f"{thread_summary}\n\n{latest}" if thread_summary else latest
    payload = [{"id": c.id, "description": c.description} for c in open_in_thread]
    result = get_llm().reconcile_thread_commitments(
        thread_context=thread_context,
        open_commitments=payload,
    )
    resolved = set(result.resolved_commitment_ids)
    for commitment in open_in_thread:
        if commitment.id in resolved:
            commitment.status = CommitmentStatus.done
    if resolved:
        db.commit()


def process_message(
    db: Session,
    message: Message,
    *,
    body: str | None = None,
    force_reclassify: bool = False,
) -> list[Commitment]:
    del force_reclassify  # reserved for sync reclassify batches
    llm = get_llm()
    user = db.get(User, message.user_id)
    if user is None:
        raise ValueError("Missing user for extraction")

    if message_user_decided(message):
        return []

    # Extraction guard — applied before the LLM runs. The classifier ran at
    # ingest time and wrote sender_classification. If it's in the blocked set,
    # we skip extraction entirely and return zero commitments. The Message row
    # itself stays (so search + inbox views still see it).
    if message.sender_classification in _EXTRACTION_BLOCKED_CLASSES:
        return []

    if body is None:
        account = get_google_account_for_message(db, message)
        if account is None:
            raise ValueError("Missing connected account for extraction")
        token = decrypt_token(account.token_ciphertext)
        body = gmail.get_message(token, message.external_id)["body"]

    thread_summary = build_thread_summary(db, message, current_body=body)
    thread_body = body
    if thread_summary:
        thread_body = f"{thread_summary}\n\nLatest message:\n{body}"

    override = automated_fyi_override(subject=message.subject, snippet=message.snippet, body=body)
    if override is not None and not (
        message.action_required
        or subject_implies_action_required(
            subject=message.subject,
            snippet=message.snippet,
            body=body,
        )
    ):
        message.classification = override.classification
        message.priority = override.priority
        message.action_required = override.action_required
        message.body_summary = override.reason
        db.commit()
        _reconcile_thread_commitments(db, user, message, body=body, thread_summary=thread_summary)
        return []

    classification = llm.classify_message(
        subject=message.subject,
        body=thread_body,
        sender=message.sender,
        user_email=user.email,
    )
    adjusted = upgrade_human_misclassified_as_fyi(
        classification=classification.classification,
        action_required=classification.action_required,
        sender_classification=message.sender_classification,
        subject=message.subject,
        snippet=message.snippet,
        body=body,
    )
    adjusted = apply_action_subject_classification(
        adjusted,
        action_required=classification.action_required or message.action_required,
        subject=message.subject,
        snippet=message.snippet,
        body=body,
    )
    if adjusted != classification.classification:
        classification = ClassificationResult(
            classification=adjusted,
            priority=classification.priority,
            action_required=True,
            reason=classification.reason,
            schedule_candidate=classification.schedule_candidate,
        )
    message.classification = classification.classification
    message.priority = classification.priority
    message.action_required = classification.action_required
    # Persist the one-line reason as the body_summary surrogate for the slice.
    message.body_summary = classification.reason

    # Anchor relative deadlines to when the email was sent, falling back to today.
    reference_date = message.sent_at.date() if message.sent_at else datetime.now(UTC).date()
    extracted = llm.extract_commitments(
        subject=message.subject,
        body=thread_body,
        sender=message.sender,
        user_email=user.email,
        reference_date=reference_date,
    )

    _reconcile_thread_commitments(db, user, message, body=body, thread_summary=thread_summary)

    # Dedup against existing open commitments (and within this batch) so separate
    # emails about the same thing do not pile up multiple near-identical entries.
    existing_open = db.scalars(
        select(Commitment).where(
            Commitment.user_id == message.user_id,
            Commitment.status == CommitmentStatus.open,
        )
    )
    seen = {_dedup_key(c.owner, c.counterparty, c.description) for c in existing_open}

    commitments: list[Commitment] = []
    for item in extracted:
        key = _dedup_key(item.owner, item.counterparty, item.description)
        if key in seen:
            continue
        seen.add(key)
        commitment = Commitment(
            user_id=message.user_id,
            description=item.description,
            owner=item.owner,
            counterparty=item.counterparty,
            due_date=item.due_date,
            priority=item.priority,
            source_type=SourceType.sms if message.source == "sms" else SourceType.gmail,
            source_id=message.id,
            evidence=item.evidence,
            confidence=item.confidence,
            from_automated=item.from_automated,
        )
        db.add(commitment)
        commitments.append(commitment)

    db.commit()

    schedule_proposal_service.maybe_extract_schedule_proposal(
        db,
        user,
        message,
        body=thread_body,
        classification=classification,
        reference_date=reference_date,
    )

    return commitments
