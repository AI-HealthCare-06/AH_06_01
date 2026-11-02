"""Explicit synthetic adapter; never silently infer metadata for a real user."""

from __future__ import annotations

import json
from datetime import date, datetime, timedelta
from pathlib import Path

from .history import KST, Measurement

FIXTURE = (
    Path(__file__).resolve().parents[2]
    / "frontend/src/design/demo-persona-quarter.json"
)


def demo_events(fixture: Path = FIXTURE, end: date = date(2026, 11, 2)):
    rows = json.loads(fixture.read_text(encoding="utf-8"))["records"]
    events = []
    for index, row in enumerate(rows):
        day = end - timedelta(days=len(rows) - 1 - index)
        for slot, hour, pressure in (
            ("morning", 8, row),
            ("evening", 20, row.get("evening")),
        ):
            if pressure is None:
                continue
            timestamp = datetime(day.year, day.month, day.day, hour, tzinfo=KST)
            events.append(
                Measurement(
                    subject_id="synthetic-studio-quarter",
                    event_id=f"{day}-{slot}",
                    revision=1,
                    measured_at=timestamp,
                    available_at=timestamp + timedelta(minutes=5),
                    session_id=f"session-{day}-{slot}",
                    slot=slot,
                    systolic=pressure["systolic"],
                    diastolic=pressure["diastolic"],
                    setting="home",
                    method="upper_arm_cuff",
                    device_id="synthetic-cuff",
                    protocol_confirmed=True,
                    synthetic=True,
                )
            )
    return events


ASSUMPTIONS = [
    "All pressures come from the existing explicitly synthetic 90-day fixture.",
    "08:00/20:00 measurement times and five-minute availability lag are simulated, not observed.",
    "Home setting, upper-arm device, protocol confirmation and stable device are simulated metadata.",
    "One source value per slot is retained; no additional repeats or people are fabricated.",
    "The persona is a single smoothly improving scripted trajectory, not independent patient validation.",
]
