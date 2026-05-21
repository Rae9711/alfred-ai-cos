"""Provider-agnostic transcription interface (PRD 10.3 voice capture).

Anthropic models do not take raw audio, so voice capture needs a separate
transcription provider. App code depends on this Protocol only; provider SDK code
is isolated in app/transcription/providers/. When no provider is configured the
factory returns None and the voice endpoint returns 501."""

from __future__ import annotations

from typing import Protocol


class Transcriber(Protocol):
    """Turns audio bytes into text."""

    def transcribe(self, *, audio: bytes, filename: str, content_type: str) -> str:
        """Return the transcript of an audio clip."""
        ...
