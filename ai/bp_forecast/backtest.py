"""Rolling-origin evaluation with matured labels and explicit abstention counts."""

from __future__ import annotations

from collections import Counter
from datetime import date, timedelta
from math import sqrt
from statistics import mean

from .forecast import HORIZON_DAYS, METHODS, forecast
from .history import (
    ContextChange,
    Measurement,
    Policy,
    aggregate,
    day_end,
    instant,
    snapshot,
)
from .policy import DEFAULT_POLICY, HOME_EVENT_DBP, HOME_EVENT_SBP, in_research_support


def outcome(
    events: list[Measurement],
    subject: str,
    origin: date,
    evaluation_as_of,
    policy: Policy = DEFAULT_POLICY,
):
    end = origin + timedelta(days=HORIZON_DAYS)
    frozen_at = day_end(end + timedelta(days=policy.label_lag_days))
    if instant(evaluation_as_of) < frozen_at:
        return None, "immature_label"
    days, _, used = aggregate(
        events, subject, frozen_at, origin + timedelta(days=1), end
    )
    # The future target needs both AM and PM; a missing slot is not a zero.
    paired = [d for d in days if len(d.slots) == 2]
    if len(paired) < policy.min_label_days:
        return None, "insufficient_future_measurements"
    # These events were unknown at the prediction cutoff. Keep their valid
    # observed outcomes in the primary score rather than selecting easier
    # future windows. Quality-specific subsets are supplementary only.
    flags = []
    if any(not in_research_support(e.systolic, e.diastolic) for e in used):
        flags.append("future_outside_research_support")
    if len({e.device_id for e in used}) > 1:
        flags.append("future_mixed_devices")
    return {
        "systolic": mean(d.systolic for d in paired),
        "diastolic": mean(d.diastolic for d in paired),
        "observed_days": len(paired),
        "frozen_at": frozen_at.isoformat(),
        "quality_flags": flags,
    }, None


def summarize(rows: list[dict]):
    eligible = [r for r in rows if r["forecast"]["point"] is not None]
    evaluated = [r for r in eligible if r["outcome"] is not None]
    metrics = {}
    for key in ("systolic", "diastolic"):
        errors = [r["forecast"]["point"][key] - r["outcome"][key] for r in evaluated]
        metrics[key] = {
            "mae_mmHg": mean(abs(e) for e in errors) if errors else None,
            "rmse_mmHg": sqrt(mean(e * e for e in errors)) if errors else None,
            "bias_mmHg": mean(errors) if errors else None,
        }
    # Future home-mean threshold events, NOT same-visit KNHANES HTN labels.
    high = lambda row: (
        row["systolic"] >= HOME_EVENT_SBP or row["diastolic"] >= HOME_EVENT_DBP
    )
    counts = {"tp": 0, "fp": 0, "tn": 0, "fn": 0}
    for row in evaluated:
        truth, predicted = high(row["outcome"]), high(row["forecast"]["point"])
        counts[
            "tp"
            if truth and predicted
            else "fn"
            if truth
            else "fp"
            if predicted
            else "tn"
        ] += 1
    positive, negative = counts["tp"] + counts["fn"], counts["fp"] + counts["tn"]
    return {
        "candidate_origins": len(rows),
        "predicted_origins": len(eligible),
        "evaluated_origins": len(evaluated),
        "forecast_coverage": len(eligible) / len(rows) if rows else None,
        "label_coverage_given_prediction": len(evaluated) / len(eligible)
        if eligible
        else None,
        "abstention_reasons": dict(
            Counter(
                reason
                for row in rows
                for reason in row["forecast"]["quality"]["reasons"]
            )
        ),
        "label_exclusions": dict(
            Counter(row["label_reason"] for row in eligible if row["label_reason"])
        ),
        "observed_label_flags": dict(
            Counter(
                flag for row in evaluated for flag in row["outcome"]["quality_flags"]
            )
        ),
        **metrics,
        "future_home_threshold_event": {
            **counts,
            "positive_n": positive,
            "negative_n": negative,
            "recall": counts["tp"] / positive if positive else None,
            "fpr": counts["fp"] / negative if negative else None,
            "comparison_to_cross_sectional_M1": "not_comparable",
        },
        "prediction_interval_coverage": None,
        "clinical_performance_claim": False,
    }


def backtest(
    events: list[Measurement],
    subject: str,
    origins: list[date],
    evaluation_as_of,
    changes: list[ContextChange] | None = None,
    policy: Policy = DEFAULT_POLICY,
):
    by_method = {method: [] for method in METHODS}
    for origin in origins:
        history = snapshot(events, subject, day_end(origin), changes, policy)
        label, label_reason = outcome(events, subject, origin, evaluation_as_of, policy)
        for method in METHODS:
            by_method[method].append(
                {
                    "origin": origin.isoformat(),
                    "forecast": forecast(history, method),
                    "outcome": label,
                    "label_reason": label_reason,
                }
            )
    common = set.intersection(
        *[
            {
                row["origin"]
                for row in rows
                if row["forecast"]["point"] is not None and row["outcome"] is not None
            }
            for rows in by_method.values()
        ]
    )
    return {
        "metrics": {method: summarize(rows) for method, rows in by_method.items()},
        "common_evaluation_origins": sorted(common),
        "common_cohort_metrics": {
            method: summarize([row for row in rows if row["origin"] in common])
            for method, rows in by_method.items()
        },
        "rows": by_method,
    }


def purged_training_windows(
    windows: list[dict], validation_subjects: set[str], validation_start: date
):
    """A future-label window may not cross the fitting cutoff, even by one day.

    A later publication/correction freezes the label later still. Pass that
    availability as label_available_at; row order and a seven-row gap are not
    substitutes for this subject + calendar-time boundary.
    """
    cutoff = day_end(validation_start - timedelta(days=1))
    return [
        w
        for w in windows
        if w["subject_id"] not in validation_subjects
        and date.fromisoformat(w["origin"]) < validation_start
        and date.fromisoformat(w["label_end"]) < validation_start
        and instant(w["label_available_at"]) <= cutoff
    ]
