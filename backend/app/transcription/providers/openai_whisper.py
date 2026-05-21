"""OpenAI Whisper transcription. The only place the OpenAI audio API is touched.

Uses httpx directly against the audio/transcriptions endpoint so the backend does
not take a hard dependency on the OpenAI SDK for one call. Audio is sent in-process
and never persisted (PRD 13.1 storage minimization extends to voice)."""

from __future__ import annotations

from typing import cast

import httpx

from app.core.config import get_settings

settings = get_settings()
_ENDPOINT = "https://api.openai.com/v1/audio/transcriptions"


class WhisperTranscriber:
    """Implements app.transcription.base.Transcriber."""

    def transcribe(self, *, audio: bytes, filename: str, content_type: str) -> str:
        resp = httpx.post(
            _ENDPOINT,
            headers={"Authorization": f"Bearer {settings.openai_api_key}"},
            files={"file": (filename, audio, content_type)},
            data={"model": settings.transcription_model},
            timeout=60,
        )
        resp.raise_for_status()
        return cast(str, resp.json()["text"])
