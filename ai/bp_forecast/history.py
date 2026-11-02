"""Point-in-time reconstruction. No dependencies beyond Python 3.11.

All policy limits here are engineering hypotheses, not clinical guidelines.
Server-acknowledged availability and immutable revisions are essential: a
measurement from yesterday uploaded tomorrow was not usable today.
"""

from __future__ import annotations

import json
from collections import Counter, defaultdict
from dataclasses import asdict, dataclass
from datetime import date, datetime, timedelta, timezone
from hashlib import sha256
from itertools import pairwise
from math import isfinite
from statistics import mean, median, pstdev

from .policy import (
    AGGREGATION_POLICY_VERSION,
    DEFAULT_POLICY,
    HORIZON_DAYS,
    QUALITY_POLICY_VERSION,
    Policy,
    in_research_support,
)

KST = timezone(timedelta(hours=9))
CONTRACT_VERSION = "bp-history-research-0.1.0"


def instant(value: str | datetime) -> datetime:
    value = (
        datetime.fromisoformat(value.replace("Z", "+00:00"))
        if isinstance(value, str)
        else value
    )
    if (
        not isinstance(value, datetime)
        or value.tzinfo is None
        or value.utcoffset() is None
    ):
        raise ValueError("timezone-aware timestamp required")
    return value.astimezone(KST)


def day_end(value: date) -> datetime:
    return datetime.combine(value, datetime.max.time(), KST)


@dataclass(frozen=True)
class Measurement:
    subject_id: str
    event_id: str
    revision: int
    measured_at: datetime | None
    available_at: datetime
    session_id: str
    slot: str
    systolic: float | None
    diastolic: float | None
    setting: str = "unknown"
    method: str = "unknown"
    device_id: str | None = None
    protocol_confirmed: bool = False
    synthetic: bool = False
    status: str = "valid"
    unit: str = "mmHg"
    reading_index: int = 1

    def __post_init__(self):
        if not all(
            isinstance(v, str) and v.strip()
            for v in (self.subject_id, self.event_id, self.session_id)
        ):
            raise ValueError("subject/event/session identifiers required")
        if type(self.revision) is not int or self.revision < 1:
            raise ValueError("positive integer revision required")
        if type(self.reading_index) is not int or self.reading_index < 1:
            raise ValueError("positive session reading index required")
        if self.unit != "mmHg" or self.slot not in ("morning", "evening"):
            raise ValueError("mmHg and morning/evening slot required")
        if self.setting not in ("home", "clinic", "unknown") or self.method not in (
            "upper_arm_cuff",
            "wrist",
            "unknown",
        ):
            raise ValueError("unsupported setting/method")
        if self.status not in ("valid", "deleted"):
            raise ValueError("unsupported revision status")
        for value in (self.protocol_confirmed, self.synthetic):
            if type(value) is not bool:
                raise ValueError("boolean metadata required")
        object.__setattr__(self, "available_at", instant(self.available_at))
        if self.measured_at is not None:
            object.__setattr__(self, "measured_at", instant(self.measured_at))
            if self.measured_at > self.available_at:
                raise ValueError("measurement cannot become available before it occurs")
        if self.status == "valid":
            s, d = self.systolic, self.diastolic
            if any(
                type(v) not in (int, float) or not isfinite(v) for v in (s, d)
            ) or not (10 <= d < s <= 999):
                raise ValueError("invalid pressure pair")


@dataclass(frozen=True)
class ContextChange:
    subject_id: str
    effective_at: datetime
    available_at: datetime
    kind: str = "medication_change"

    def __post_init__(self):
        if not isinstance(self.subject_id, str) or not self.subject_id.strip():
            raise ValueError("context subject required")
        object.__setattr__(self, "effective_at", instant(self.effective_at))
        object.__setattr__(self, "available_at", instant(self.available_at))
        if self.kind not in ("medication_change", "acute_illness", "device_change"):
            raise ValueError("unknown context change")


@dataclass(frozen=True)
class DailyPressure:
    day: date
    systolic: float
    diastolic: float
    slots: tuple[str, ...]
    reading_count: int
    session_count: int


@dataclass(frozen=True)
class Snapshot:
    as_of: datetime
    days: tuple[DailyPressure, ...]
    reasons: tuple[str, ...]
    excluded: dict[str, int]
    features: dict[str, float | int | None]
    fingerprint: str
    provenance: str
    policy: Policy

    @property
    def eligible(self):
        return not self.reasons


def visible_revisions(events: list[Measurement], subject: str, as_of: datetime):
    """Filter knowledge time BEFORE choosing a revision, including tombstones."""
    cutoff = instant(as_of)
    visible: dict[str, dict[int, Measurement]] = defaultdict(dict)
    for event in events:
        if event.subject_id != subject or event.available_at > cutoff:
            continue
        revisions = visible[event.event_id]
        if event.revision in revisions and revisions[event.revision] != event:
            raise ValueError("conflicting payload for the same immutable revision")
        revisions[event.revision] = event
    selected = []
    for revisions in visible.values():
        ordered = sorted(revisions.values(), key=lambda e: e.revision)
        if any(b.available_at < a.available_at for a, b in pairwise(ordered)):
            raise ValueError("revision availability must be monotonic")
        selected.append(ordered[-1])
    return sorted(selected, key=lambda e: e.event_id)


def aggregate(
    events: list[Measurement], subject: str, as_of: datetime, start: date, end: date
):
    """Repeat -> session -> slot -> day. No zero fill or selective outlier removal."""
    by_session = defaultdict(list)
    session_keys = {}
    reading_keys = {}
    excluded = Counter()
    eligible = []
    for event in visible_revisions(events, subject, as_of):
        reason = (
            "deleted"
            if event.status == "deleted"
            else "unknown_measurement_time"
            if event.measured_at is None
            else "future_measurement"
            if event.measured_at > instant(as_of)
            else "outside_window"
            if not (start <= event.measured_at.date() <= end)
            else "not_home_upper_arm"
            if event.setting != "home" or event.method != "upper_arm_cuff"
            else "unconfirmed_protocol"
            if not event.protocol_confirmed
            else "unknown_device"
            if not event.device_id
            else None
        )
        if reason:
            excluded[reason] += 1
            continue
        key = (event.measured_at.date(), event.slot, event.session_id)
        if event.session_id in session_keys and session_keys[event.session_id] != key:
            raise ValueError("session reused across dates/slots")
        session_keys[event.session_id] = key
        reading_key = (*key, event.reading_index)
        if reading_key in reading_keys:
            prior = reading_keys[reading_key]
            if (
                prior.systolic,
                prior.diastolic,
                prior.measured_at,
                prior.device_id,
                prior.synthetic,
            ) != (
                event.systolic,
                event.diastolic,
                event.measured_at,
                event.device_id,
                event.synthetic,
            ):
                raise ValueError("conflicting source reading at session index")
            excluded["duplicate_source_reading"] += 1
            continue
        reading_keys[reading_key] = event
        eligible.append(event)
        by_session[key].append(event)
    slots = defaultdict(list)
    for (day, slot, _), readings in by_session.items():
        # Repeats in a session cannot multiply the weight of that slot/day.
        slots[(day, slot)].append(
            (
                mean(e.systolic for e in readings),
                mean(e.diastolic for e in readings),
                len(readings),
            )
        )
    daily = defaultdict(list)
    for (day, slot), sessions in slots.items():
        daily[day].append(
            (
                slot,
                mean(s[0] for s in sessions),
                mean(s[1] for s in sessions),
                sum(s[2] for s in sessions),
                len(sessions),
            )
        )
    rows = tuple(
        DailyPressure(
            day,
            mean(s[1] for s in values),
            mean(s[2] for s in values),
            tuple(sorted(s[0] for s in values)),
            sum(s[3] for s in values),
            sum(s[4] for s in values),
        )
        for day, values in sorted(daily.items())
    )
    return rows, dict(excluded), eligible


def snapshot(
    events: list[Measurement],
    subject: str,
    as_of: datetime,
    changes: list[ContextChange] | None = None,
    policy: Policy = DEFAULT_POLICY,
) -> Snapshot:
    cutoff = instant(as_of)
    today = cutoff.date()
    start = today - timedelta(days=policy.lookback_days - 1)
    days, excluded, used = aggregate(events, subject, cutoff, start, today)
    recent = [d for d in days if d.day >= today - timedelta(days=6)]
    paired = [d for d in recent if len(d.slots) == 2]
    reasons = []
    if len(days) < policy.min_history_days:
        reasons.append("insufficient_history_days")
    if not days or (days[-1].day - days[0].day).days + 1 < policy.min_span_days:
        reasons.append("insufficient_calendar_span")
    if len(recent) < policy.min_recent_days:
        reasons.append("insufficient_recent_days")
    if len(paired) < policy.min_recent_paired_days:
        reasons.append("insufficient_paired_days")
    if not days or (today - days[-1].day).days > policy.max_age_days:
        reasons.append("stale_measurements")
    if len({e.device_id for e in used}) > 1:
        reasons.append("device_change_in_lookback")
    if any(e.synthetic for e in used) and not all(e.synthetic for e in used):
        reasons.append("mixed_data_provenance")
    if any(not in_research_support(e.systolic, e.diastolic) for e in used):
        reasons.append("outside_research_support")
    known_changes = sorted(
        (
            c
            for c in (changes or [])
            if c.subject_id == subject
            and c.available_at <= cutoff
            and cutoff - timedelta(days=policy.change_washout_days)
            <= c.effective_at
            <= day_end(today + timedelta(days=HORIZON_DAYS))
        ),
        key=lambda c: (c.effective_at, c.available_at, c.kind),
    )
    reasons.extend(
        ("planned_" if c.effective_at > cutoff else "recent_") + c.kind
        for c in known_changes
    )
    features = {
        "history_days": len(days),
        "recent_days": len(recent),
        "paired_recent_days": len(paired),
        "reading_count": len(used),
        "days_since_latest": (today - days[-1].day).days if days else None,
    }
    for key in ("systolic", "diastolic"):
        values = [getattr(d, key) for d in days]
        features[key + "_mean_28d"] = mean(values) if values else None
        features[key + "_sd_28d"] = pstdev(values) if values else None
        features[key + "_median_28d"] = median(values) if values else None
        features[key + "_mean_7d"] = (
            mean(getattr(d, key) for d in recent) if recent else None
        )
    payload = {
        "contract": CONTRACT_VERSION,
        "quality_policy_version": QUALITY_POLICY_VERSION,
        "aggregation_policy_version": AGGREGATION_POLICY_VERSION,
        "as_of": cutoff.isoformat(),
        "subject": subject,
        "policy": asdict(policy),
        "events": [asdict(e) for e in used],
        # Cache identity covers quality exclusions and tombstones too, not only
        # the rows used in the numeric features. Future/unavailable revisions
        # are still filtered out before hashing.
        "known_revisions": [
            asdict(e) for e in visible_revisions(events, subject, cutoff)
        ],
        "excluded": excluded,
        "changes": [asdict(c) for c in known_changes],
    }
    digest = sha256(
        json.dumps(payload, sort_keys=True, default=str).encode()
    ).hexdigest()
    provenance = (
        "synthetic"
        if used and all(e.synthetic for e in used)
        else "mixed"
        if any(e.synthetic for e in used)
        else "real-unvalidated"
        if used
        else "none"
    )
    return Snapshot(
        cutoff,
        days,
        tuple(dict.fromkeys(reasons)),
        excluded,
        features,
        digest,
        provenance,
        policy,
    )
