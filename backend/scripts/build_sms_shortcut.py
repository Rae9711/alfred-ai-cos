#!/usr/bin/env python3
"""Generate and sign the Albert SMS Forward iOS Shortcut (macOS only).

Usage (from repo root):
  python3 backend/scripts/build_sms_shortcut.py

Requires the macOS `shortcuts` CLI for signing.
"""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

from app.services.sms_shortcut import (  # noqa: E402
    SHORTCUT_FILENAME,
    build_sms_forward_shortcut,
    signed_shortcut_path,
)


def main() -> None:
    out_dir = signed_shortcut_path().parent
    out_dir.mkdir(parents=True, exist_ok=True)
    unsigned = out_dir / "Albert-SMS-Forward.unsigned.shortcut"
    signed = signed_shortcut_path()

    unsigned.write_bytes(build_sms_forward_shortcut())
    print(f"→ wrote unsigned plist {unsigned}")

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

    unsigned.unlink(missing_ok=True)
    print(f"✓ signed shortcut → {signed} ({signed.stat().st_size} bytes)")


if __name__ == "__main__":
    main()
