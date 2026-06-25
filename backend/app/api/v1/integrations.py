"""Static integration assets (iOS Shortcut, etc.)."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse

from app.services.sms_shortcut import SHORTCUT_FILENAME, signed_shortcut_path

router = APIRouter(tags=["integrations"])


@router.get("/integrations/ios/{filename}")
def download_ios_shortcut(filename: str) -> FileResponse:
    if filename != SHORTCUT_FILENAME:
        raise HTTPException(status_code=404, detail="Not found")
    path = signed_shortcut_path()
    if not path.is_file():
        raise HTTPException(status_code=503, detail="SMS shortcut is not available")
    return FileResponse(
        path,
        media_type="application/octet-stream",
        filename=SHORTCUT_FILENAME,
    )
