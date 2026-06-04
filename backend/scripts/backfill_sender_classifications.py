"""One-shot backfill: classify every Message whose sender_classification is
NULL. Run once after deploying the c3d4e5f6a7b8 migration so the spam shield
protects historic commitments without a re-ingest.

Usage:
    cd backend && uv run python scripts/backfill_sender_classifications.py
"""

from __future__ import annotations

from app.db.base import SessionLocal
from app.services import sender_class


def main() -> None:
    db = SessionLocal()
    try:
        n = sender_class.backfill_classifications(db)
    finally:
        db.close()
    print(f"Classified {n} message(s).")


if __name__ == "__main__":
    main()
