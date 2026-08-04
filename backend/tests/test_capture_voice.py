"""Capture voice / transcribe route tests."""

from __future__ import annotations

from io import BytesIO

import pytest
from fastapi import HTTPException, UploadFile
from sqlalchemy.orm import Session

from app.api.v1 import capture as capture_api
from app.db.models import User
from app.schemas.llm import ParsedTask
from app.db.enums import Priority
from tests.fakes import FakeLLM


class _FakeTranscriber:
    def __init__(self, text: str = "remind me to call Mom") -> None:
        self.text = text
        self.calls: list[dict[str, object]] = []

    def transcribe(self, *, audio: bytes, filename: str, content_type: str) -> str:
        self.calls.append(
            {"audio": audio, "filename": filename, "content_type": content_type}
        )
        return self.text


@pytest.fixture
def user(db: Session) -> User:
    u = User(email="voice@example.com", timezone="UTC")
    db.add(u)
    db.commit()
    return u


def _audio_upload(data: bytes = b"fake-audio") -> UploadFile:
    return UploadFile(filename="note.m4a", file=BytesIO(data))


@pytest.mark.asyncio
async def test_transcribe_returns_transcript_without_tasks(
    db: Session,
    user: User,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    fake = _FakeTranscriber("book lunch with Sam tomorrow")
    monkeypatch.setattr(capture_api, "get_transcriber", lambda: fake)

    # Ensure capture_text is not invoked for dictation.
    def _boom(*_a: object, **_k: object) -> None:
        raise AssertionError("dictation must not persist tasks")

    monkeypatch.setattr(capture_api.capture_service, "capture_text", _boom)

    out = await capture_api.transcribe_voice(audio=_audio_upload(), _user=user)
    assert out.transcript == "book lunch with Sam tomorrow"
    assert len(fake.calls) == 1


@pytest.mark.asyncio
async def test_transcribe_501_when_unconfigured(
    user: User,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(capture_api, "get_transcriber", lambda: None)
    with pytest.raises(HTTPException) as exc:
        await capture_api.transcribe_voice(audio=_audio_upload(), _user=user)
    assert exc.value.status_code == 501


@pytest.mark.asyncio
async def test_capture_voice_includes_transcript(
    db: Session,
    user: User,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    fake_stt = _FakeTranscriber("Call the broker tomorrow")
    monkeypatch.setattr(capture_api, "get_transcriber", lambda: fake_stt)
    monkeypatch.setattr(
        capture_api.capture_service,
        "get_llm",
        lambda: FakeLLM(
            capture_tasks=[
                ParsedTask(title="Call the broker", priority=Priority.high),
            ]
        ),
    )

    out = await capture_api.capture_voice(
        audio=_audio_upload(), user=user, db=db
    )
    assert out.transcript == "Call the broker tomorrow"
    assert len(out.tasks) == 1
    assert out.tasks[0].title == "Call the broker"
