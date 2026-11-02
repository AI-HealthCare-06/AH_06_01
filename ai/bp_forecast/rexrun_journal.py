"""Read an owner-scoped, complete server revision export for offline research.

Never accepts the device outbox (no server revision/available_at), fabricates
an AM/PM timestamp, or fetches patient records. The caller must obtain consent
and export through an authorized server path. Partial latest-head exports are
rejected when prior revisions are missing. No production forecasting is enabled.
"""

from __future__ import annotations

from collections import defaultdict
from datetime import date
from hashlib import sha256

from .history import Measurement, instant


def from_server_revisions(
    rows: list[dict], *, subject: str, synthetic: bool
) -> list[Measurement]:
    if type(synthetic) is not bool:
        raise ValueError("explicit synthetic/real provenance required")
    events = []
    revisions = defaultdict(set)
    for row in rows:
        revision, received = row.get("revision"), row.get("available_at")
        if type(revision) is not int or revision < 1 or not received:
            raise ValueError(
                "server acknowledgment required; device outbox is not history"
            )
        command = row["command"]
        value, key = command["value"], command["entry_key"]
        recorded_on = date.fromisoformat(value["recorded_on"])
        slot, status = value["slot"], value["status"]
        if (
            key != f"survey:{recorded_on}:{slot}"
            or slot not in ("morning", "evening")
            or status not in ("measured", "deleted")
            or value["unit"] != "mmHg"
        ):
            raise ValueError("invalid server measurement key/status/unit")
        metadata = value["metadata"]
        precision, measured = metadata["timePrecision"], metadata["measuredAt"]
        if precision not in ("minute", "day") or (precision == "minute") != (
            measured is not None
        ):
            raise ValueError("invalid measurement time precision")
        timestamp = instant(measured) if measured is not None else None
        if timestamp is not None and timestamp.date() != recorded_on:
            raise ValueError("measurement calendar day mismatch")
        label = metadata["deviceLabel"]
        if label is not None and (not isinstance(label, str) or not label.strip()):
            raise ValueError("invalid device alias")
        device = sha256(f"{subject}:{label}".encode()).hexdigest() if label else None
        setting, method = metadata["setting"], metadata["method"]
        if setting not in ("home", "clinic", "unknown") or method not in (
            "upper-arm-cuff",
            "wrist",
            "other",
            "unknown",
        ):
            raise ValueError("invalid measurement context")
        if (
            metadata["protocolConfirmed"] is not None
            and type(metadata["protocolConfirmed"]) is not bool
        ):
            raise ValueError("invalid protocol response")
        if value["source"] not in ("manual-survey", "legacy-survey"):
            raise ValueError("unsupported measurement source")
        if value["source"] == "legacy-survey" and (
            timestamp is not None
            or setting != "unknown"
            or method != "unknown"
            or label is not None
            or metadata["protocolConfirmed"] is not None
        ):
            raise ValueError("invented legacy metadata")
        if status == "deleted" and (
            value["systolic"] is not None or value["diastolic"] is not None
        ):
            raise ValueError("invalid deletion revision")
        events.append(
            Measurement(
                subject_id=subject,
                event_id=key,
                revision=revision,
                measured_at=timestamp,
                available_at=instant(received),
                session_id=key,
                slot=slot,
                systolic=value["systolic"],
                diastolic=value["diastolic"],
                setting=setting,
                method="upper_arm_cuff"
                if method == "upper-arm-cuff"
                else "wrist"
                if method == "wrist"
                else "unknown",
                device_id=device,
                protocol_confirmed=metadata["protocolConfirmed"] is True,
                synthetic=synthetic,
                status="valid" if status == "measured" else "deleted",
            )
        )
        revisions[key].add(revision)
    if any(values != set(range(1, max(values) + 1)) for values in revisions.values()):
        raise ValueError(
            "incomplete revision history; latest-head exports cannot reconstruct the past"
        )
    return events
