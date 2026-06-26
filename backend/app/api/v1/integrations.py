"""Static integration assets (iOS Shortcut, etc.)."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse

from app.services.sms_shortcut import (
    LEGACY_BACKFILL_SHORTCUT_FILENAME,
    SHARE_SHORTCUT_FILENAME,
    SHORTCUT_FILENAME,
    signed_share_shortcut_path,
    signed_shortcut_path,
)

router = APIRouter(tags=["integrations"])


@router.get("/integrations/ios/{filename}")
def download_ios_shortcut(filename: str) -> FileResponse:
    if filename == SHORTCUT_FILENAME:
        path = signed_shortcut_path()
        download_name = SHORTCUT_FILENAME
    elif filename in (SHARE_SHORTCUT_FILENAME, LEGACY_BACKFILL_SHORTCUT_FILENAME):
        path = signed_share_shortcut_path()
        download_name = SHARE_SHORTCUT_FILENAME
    else:
        raise HTTPException(status_code=404, detail="Not found")
    if not path.is_file():
        raise HTTPException(status_code=503, detail="SMS shortcut is not available")
    return FileResponse(
        path,
        media_type="application/x-shortcut",
        filename=download_name,
    )
