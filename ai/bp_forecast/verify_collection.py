"""Check browser -> SQL -> forecaster mapping using generated synthetic data.

This command intentionally refuses real patient exports. No network access.
"""

from __future__ import annotations

import argparse
import json
from datetime import timedelta
from pathlib import Path

from .forecast import forecast
from .history import snapshot
from .rexrun_journal import from_server_revisions


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, required=True)
    args = parser.parse_args()
    data = json.loads(args.input.read_text(encoding="utf-8"))
    if data.get("synthetic") is not True or data.get("contract") != "bp-history-v1":
        raise ValueError("only generated synthetic server evidence accepted")
    events = from_server_revisions(
        data["records"], subject="synthetic-browser-sql", synthetic=True
    )
    cutoff = max(e.available_at for e in events) + timedelta(seconds=1)
    history = snapshot(events, "synthetic-browser-sql", cutoff)
    result = forecast(history)
    assert result["status"] == "abstained" and not result["production_eligible"]
    assert "insufficient_history_days" in result["quality"]["reasons"]
    assert any(e.revision > 1 for e in events)
    assert any(e.measured_at is not None and e.device_id for e in events)
    assert any(e.measured_at is None for e in events)
    print(
        json.dumps(
            {
                "server_revisions": len(events),
                "calendar_days": len(history.days),
                "unknown_metadata_preserved": True,
                "insufficient_history_abstains": True,
                "production_enabled": False,
            }
        )
    )


if __name__ == "__main__":
    main()
