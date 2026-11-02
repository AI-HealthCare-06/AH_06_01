"""Frozen simple baselines. These are engineering prototypes, not a service.

No calibrated uncertainty, diagnosis, treatment advice, M1 probability or v9
score is emitted. An observed-history SD is NOT a prediction interval.
"""

from __future__ import annotations

from dataclasses import asdict
from datetime import timedelta
from math import isfinite
from statistics import mean, median

from .history import CONTRACT_VERSION, Snapshot
from .policy import (
    AGGREGATION_POLICY_VERSION,
    HORIZON_DAYS,
    QUALITY_POLICY_VERSION,
    in_research_support,
)

METHODS = (
    "last_daily",
    "mean_7d",
    "median_7d",
    "mean_28d",
    "ewma_7d",
    "damped_trend_28d",
)


def estimate(history: Snapshot, method: str) -> dict[str, float]:
    if method not in METHODS:
        raise ValueError("unknown baseline")
    if not history.eligible:
        raise ValueError("ineligible history")
    end = history.as_of.date()
    recent = [d for d in history.days if d.day >= end - timedelta(days=6)]
    output = {}
    for key in ("systolic", "diastolic"):
        values = [getattr(d, key) for d in history.days]
        if method == "last_daily":
            value = values[-1]
        elif method in ("mean_7d", "median_7d"):
            value = (mean if method == "mean_7d" else median)(
                getattr(d, key) for d in recent
            )
        elif method == "mean_28d":
            value = mean(values)
        elif method == "ewma_7d":
            # Calendar-age weighting, including gaps, with seven-day half-life.
            weights = [2 ** (-(end - d.day).days / 7) for d in history.days]
            value = sum(v * w for v, w in zip(values, weights)) / sum(weights)
        else:
            x = [(d.day - end).days for d in history.days]
            slope = median(
                (values[j] - values[i]) / (x[j] - x[i])
                for i in range(len(x))
                for j in range(i + 1, len(x))
            )
            level = median(v - slope * t for t, v in zip(x, values))
            # Fixed research parameter; not selected on the video persona.
            horizon_drift = mean(
                sum(0.8**j for j in range(1, h + 1)) for h in range(1, HORIZON_DAYS + 1)
            )
            value = level + slope * horizon_drift
        output[key] = value
    return output


def forecast(history: Snapshot, method: str = "mean_7d") -> dict:
    origin = history.as_of.date()
    reasons = list(history.reasons)
    point = estimate(history, method) if history.eligible else None
    if point and (
        not all(isfinite(v) for v in point.values())
        or not in_research_support(point["systolic"], point["diastolic"])
    ):
        reasons.append("unsupported_projection")
        point = None
    return {
        "schema_version": CONTRACT_VERSION,
        "role": "measurement_forecast",
        "status": "research_only" if point else "abstained",
        "production_eligible": False,
        "as_of": history.as_of.isoformat(),
        "model_version": "history-baseline-" + method + "-v0",
        "feature_version": CONTRACT_VERSION,
        "quality_policy_version": QUALITY_POLICY_VERSION,
        "aggregation_policy_version": AGGREGATION_POLICY_VERSION,
        "input_window": {
            "start": (
                origin - timedelta(days=history.policy.lookback_days - 1)
            ).isoformat(),
            "end": origin.isoformat(),
            "cutoff": history.as_of.isoformat(),
        },
        "target": {
            "name": "next_7d_recorded_home_daily_mean",
            "start": (origin + timedelta(days=1)).isoformat(),
            "end": (origin + timedelta(days=HORIZON_DAYS)).isoformat(),
            "horizon_days": HORIZON_DAYS,
            "minimum_observed_days": history.policy.min_label_days,
            "unit": "mmHg",
        },
        "point": {k: round(v, 3) for k, v in point.items()} if point else None,
        "prediction_interval": None,
        "interval_status": "independent_real_world_calibration_required",
        "diagnosis": None,
        "quality": {
            "reasons": reasons,
            "features": history.features,
            "excluded": history.excluded,
            "policy": asdict(history.policy),
        },
        "provenance": {
            "data": history.provenance,
            "input_fingerprint": history.fingerprint,
        },
        "limitations": [
            "not_clinically_validated",
            "conditional_on_future_measurement_availability",
            "not_a_treatment_effect",
            "no_validated_prediction_interval",
        ],
    }
