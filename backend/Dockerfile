# Albert backend image. One image, three roles (web / worker / beat) selected by the
# compose command. Python 3.12 + uv for reproducible installs from uv.lock.
#
# No --platform pin on purpose: each host builds natively. The VPS deploy builds amd64
# on the (amd64) server via deploy/albert-deploy.sh; a local arm64 Mac builds arm64 for
# smoke tests only. The local image never ships to the VPS, so cross-arch can't bite.
# Don't add `platform:` to compose (forces slow emulation) or `docker save` a local
# image onto the server (wrong arch).

FROM python:3.12-slim AS base

# uv: fast, lockfile-driven installs. Copy the static binary from the official image.
COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /bin/

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PROJECT_ENVIRONMENT=/app/.venv \
    PATH="/app/.venv/bin:$PATH"

# psycopg[binary] ships its own libpq, so no system postgres-client needed. curl is for
# the container healthcheck.
RUN apt-get update \
    && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install deps first (cached layer) using only the lock + manifest, then the app code.
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-install-project --no-dev

COPY . .
RUN uv sync --frozen --no-dev

# Run as a non-root user.
RUN useradd --create-home --uid 10001 albert && chown -R albert:albert /app
USER albert

EXPOSE 8000

# Default role is the web server; compose overrides command for worker/beat.
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
