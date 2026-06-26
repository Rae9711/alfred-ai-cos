#!/usr/bin/env python3
"""Generate and sign the Albert SMS iOS Shortcuts (macOS only).

Usage (from repo root):
  python3 backend/scripts/build_sms_shortcut.py

Requires the macOS `shortcuts` CLI for signing.
"""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))

from app.services.sms_shortcut import (  # noqa: E402
    LEGACY_BACKFILL_SHORTCUT_FILENAME,
    SHARE_SHORTCUT_FILENAME,
    SHORTCUT_FILENAME,
    build_sms_forward_shortcut,
    build_sms_share_shortcut,
    signed_share_shortcut_path,
    signed_shortcut_path,
)


def _sign(*, unsigned: Path, signed: Path) -> None:
    try:
        subprocess.run(
            [
                "shortcuts",
                "sign",
                "-i",
                str(unsigned),
                "-o",
                str(signed),
                "--mode",
                "anyone",
            ],
            check=True,
            capture_output=True,
            text=True,
        )
    except FileNotFoundError:
        print("ERROR: macOS `shortcuts` CLI not found — copy unsigned file to a Mac and run:")
        print(f"  shortcuts sign -i {unsigned} -o {signed} --mode anyone")
        sys.exit(1)
    except subprocess.CalledProcessError as exc:
        print(exc.stderr or exc.stdout or str(exc))
        sys.exit(exc.returncode)


def _build_and_sign(*, name: str, filename: str, builder, signed: Path) -> None:
    out_dir = signed.parent
    out_dir.mkdir(parents=True, exist_ok=True)
    unsigned = out_dir / filename.replace(".shortcut", ".unsigned.shortcut")
    unsigned.write_bytes(builder())
    print(f"→ wrote unsigned plist {unsigned}")
    _sign(unsigned=unsigned, signed=signed)
    unsigned.unlink(missing_ok=True)
    print(f"✓ signed {name} → {signed} ({signed.stat().st_size} bytes)")


def main() -> None:
    _build_and_sign(
        name="SMS Forward",
        filename=SHORTCUT_FILENAME,
        builder=build_sms_forward_shortcut,
        signed=signed_shortcut_path(),
    )
    share_signed = signed_share_shortcut_path()
    _build_and_sign(
        name="SMS Share",
        filename=SHARE_SHORTCUT_FILENAME,
        builder=build_sms_share_shortcut,
        signed=share_signed,
    )
    legacy = share_signed.parent / LEGACY_BACKFILL_SHORTCUT_FILENAME
    legacy.write_bytes(share_signed.read_bytes())
    print(f"✓ legacy alias {LEGACY_BACKFILL_SHORTCUT_FILENAME} → same bytes as Share")


if __name__ == "__main__":
    main()
