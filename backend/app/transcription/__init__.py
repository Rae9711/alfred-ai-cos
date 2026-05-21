"""Transcription factory. Returns the configured Transcriber, or None when voice
capture is disabled (no provider set). App code checks for None and returns 501."""

from functools import lru_cache

from app.core.config import get_settings
from app.transcription.base import Transcriber


@lru_cache
def get_transcriber() -> Transcriber | None:
    settings = get_settings()
    if settings.transcription_provider == "openai" and settings.openai_api_key:
        from app.transcription.providers.openai_whisper import WhisperTranscriber

        return WhisperTranscriber()
    return None
