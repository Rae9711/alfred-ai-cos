"""Transcription factory tests. Voice capture is disabled by default (no provider),
so the factory returns None and the route returns 501."""

from app.transcription import get_transcriber


def test_disabled_by_default() -> None:
    # The test env sets no transcription provider, so voice capture is off.
    get_transcriber.cache_clear()
    assert get_transcriber() is None
