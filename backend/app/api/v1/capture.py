"""Capture routes (PRD 10.3). Text and voice capture."""

from __future__ import annotations

from datetime import UTC, datetime

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from sqlalchemy.orm import Session

from app.core.security import get_current_user
from app.db.base import get_db
from app.db.enums import SourceType
from app.db.models import User
from app.schemas.api import CaptureRequest, CaptureResponse, TaskOut
from app.services import capture as capture_service
from app.transcription import get_transcriber

router = APIRouter(prefix="/capture", tags=["capture"])


@router.post("", response_model=CaptureResponse)
def capture(
    payload: CaptureRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> CaptureResponse:
    tasks, project = capture_service.capture_text(
        db, user.id, text=payload.text, reference_date=datetime.now(UTC).date()
    )
    return CaptureResponse(
        tasks=[TaskOut.model_validate(t) for t in tasks], detected_project=project
    )


@router.post("/voice", response_model=CaptureResponse)
async def capture_voice(
    audio: UploadFile = File(...),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> CaptureResponse:
    """Transcribe an audio note then parse it into tasks. Returns 501 when no
    transcription provider is configured (audio is processed in-process, not stored)."""
    transcriber = get_transcriber()
    if transcriber is None:
        raise HTTPException(
            status_code=501,
            detail="Voice capture is not configured. Set a transcription provider.",
        )
    data = await audio.read()
    transcript = transcriber.transcribe(
        audio=data,
        filename=audio.filename or "note.m4a",
        content_type=audio.content_type or "audio/m4a",
    )
    tasks, project = capture_service.capture_text(
        db,
        user.id,
        text=transcript,
        reference_date=datetime.now(UTC).date(),
        source_type=SourceType.voice,
    )
    return CaptureResponse(
        tasks=[TaskOut.model_validate(t) for t in tasks], detected_project=project
    )
