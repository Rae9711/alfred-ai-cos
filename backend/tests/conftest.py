"""Test bootstrap. Sets the minimal env the Settings model requires before any
app module imports it, so unit tests run without a real .env or live services.
Also provides an in-memory SQLite session and a fake LLM so service-level tests
run without Postgres or Anthropic."""

import os
from collections.abc import Iterator

os.environ.setdefault("DATABASE_URL", "postgresql+psycopg://albert:albert@localhost:5432/albert")
os.environ.setdefault("REDIS_URL", "redis://localhost:6379/0")
os.environ.setdefault("JWT_SECRET", "test-secret")
# A valid Fernet key (urlsafe base64, 32 bytes) so crypto imports succeed in tests.
os.environ.setdefault("TOKEN_ENCRYPTION_KEY", "ZmDfcTF7_60GrrY167zsiPd67pEvs0aGOv2oasOM1Pg=")

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

# Import models so they register on Base.metadata before create_all.
import app.db.models  # noqa: F401,E402
from app.db.base import Base


@pytest.fixture
def db() -> Iterator[Session]:
    """A fresh in-memory SQLite database per test. SQLite handles the generic JSON,
    String, Date, and DateTime columns the models use."""
    engine = create_engine("sqlite://")
    Base.metadata.create_all(engine)
    TestSession = sessionmaker(bind=engine, expire_on_commit=False)
    session = TestSession()
    try:
        yield session
    finally:
        session.close()
        Base.metadata.drop_all(engine)
