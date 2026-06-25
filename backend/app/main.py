"""FastAPI application entrypoint. Run: uv run uvicorn app.main:app --reload"""

import logging

from fastapi import FastAPI, Request
from fastapi.exception_handlers import request_validation_exception_handler
from fastapi.exceptions import RequestValidationError

from app.api.v1 import api_router
from app.core.config import get_settings

logger = logging.getLogger(__name__)
settings = get_settings()

app = FastAPI(
    title="Albert",
    version="0.1.0",
    description="AI chief of staff. First slice: Gmail -> commitments -> Today -> draft reply.",
)
app.include_router(api_router)


@app.exception_handler(RequestValidationError)
async def log_validation_errors(request: Request, exc: RequestValidationError):
    if request.url.path.endswith("/inbox/sms"):
        raw = (await request.body())[:500]
        logger.warning(
            "SMS inbox payload validation failed: %s raw=%r",
            exc.errors(),
            raw.decode("utf-8", errors="replace"),
        )
    return await request_validation_exception_handler(request, exc)


@app.get("/health", tags=["meta"])
def health() -> dict[str, str]:
    return {"status": "ok", "environment": settings.environment}
