"""One-shot backfill: classify every Message whose sender_classification is
NULL. Run once after deploying the c3d4e5f6a7b8 migration so the spam shield
protects historic commitments without a re-ingest.

Usage:
    cd backend && uv run python scripts/backfill_sender_classifications.py
"""

from __future__ import annotations

import sys
from pathlib import Path

# Make the script runnable from anywhere (e.g. systemd, cron) without needing
# PYTHONPATH=. The script lives at backend/scripts/, so the backend dir (which
# contains the `app` package) is its parent.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.db.base import SessionLocal  # noqa: E402
from app.services import sender_class  # noqa: E402


def main() -> None:
    # Pass --force to re-classify EVERY row (used after the classifier rules
    # change). Default touches only NULL rows.
    force = "--force" in sys.argv
    db = SessionLocal()
    try:
        n = sender_class.backfill_classifications(db, force=force)
    finally:
        db.close()
    print(f"Classified {n} message(s).{' (force=True)' if force else ''}")


if __name__ == "__main__":
    main()
