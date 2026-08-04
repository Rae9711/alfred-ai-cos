"""FastAPI application entrypoint. Run: uv run uvicorn app.main:app --reload"""

import logging

from asgi_correlation_id import CorrelationIdMiddleware
from fastapi import FastAPI, Request, Response
from fastapi.exception_handlers import request_validation_exception_handler
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from prometheus_fastapi_instrumentator import Instrumentator

from app.api.v1 import api_router
from app.core.config import get_settings
from app.core.logging import configure_logging
from app.core.observability import init_sentry
from app.services.llm_quota import LlmQuotaExceeded

# Order matters: Sentry + logging must be configured before the app (and any request)
# so early errors are captured and every log line is structured/redacted.
init_sentry()
configure_logging()

logger = logging.getLogger(__name__)
settings = get_settings()

app = FastAPI(
    title="Albert",
    version="0.1.0",
    description="AI chief of staff. First slice: Gmail -> commitments -> Today -> draft reply.",
)
# X-Request-ID in/out: correlates a request across our logs and with the mobile client,
# which sends its own X-Request-ID. Bound into structlog contextvars via merge_contextvars.
app.add_middleware(CorrelationIdMiddleware)
app.include_router(api_router)

# Prometheus: default HTTP metrics plus our custom LLM/sync/gmail counters, scraped at
# /metrics. Excluded from the OpenAPI schema — it's an ops endpoint, not a public API.
Instrumentator().instrument(app).expose(app, endpoint="/metrics", include_in_schema=False)


@app.exception_handler(LlmQuotaExceeded)
async def llm_quota_exceeded(_request: Request, exc: LlmQuotaExceeded) -> JSONResponse:
    return JSONResponse(
        status_code=402,
        content={
            "detail": (
                "Monthly AI allowance used up. It resets next calendar month, "
                "or contact support if you need more for testing."
            ),
            "used_usd": round(exc.used_minor / 100, 2),
            "cap_usd": round(exc.cap_minor / 100, 2),
        },
    )


@app.exception_handler(RequestValidationError)
async def log_validation_errors(request: Request, exc: RequestValidationError) -> Response:
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
