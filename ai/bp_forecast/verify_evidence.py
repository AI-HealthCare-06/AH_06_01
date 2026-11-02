"""Check every research response, invariants and published synthetic aggregates.

Uses jsonschema only for this optional verification command, never inference.
"""

from __future__ import annotations

import argparse
import json
from copy import deepcopy
from datetime import date, timedelta
from hashlib import sha256
from itertools import pairwise
from pathlib import Path

from .demo import FIXTURE


def main():
    from jsonschema import Draft202012Validator, FormatChecker

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--input", type=Path, default=Path(".cache/bp-forecast-design/results.json")
    )
    args = parser.parse_args()
    report = json.loads(args.input.read_text(encoding="utf-8"))
    base = Path(__file__).resolve().parent
    schema = json.loads((base / "forecast.schema.json").read_text(encoding="utf-8"))
    Draft202012Validator.check_schema(schema)
    validator = Draft202012Validator(schema, format_checker=FormatChecker())
    responses = list(report["current_research_forecasts"].values()) + [
        s["forecast"] for s in report["scenarios"].values()
    ]
    for response in responses:
        validator.validate(response)
        target = response["target"]
        start, end = (
            date.fromisoformat(target["start"]),
            date.fromisoformat(target["end"]),
        )
        assert (end - start).days == 6
        assert (start - date.fromisoformat(response["as_of"][:10])).days == 1
        if response["point"]:
            assert response["point"]["systolic"] > response["point"]["diastolic"]
    altered = deepcopy(responses[0])
    altered["production_eligible"] = True
    assert not validator.is_valid(altered), (
        "schema must reject accidental production activation"
    )
    altered = deepcopy(responses[0])
    altered["model_version"] = "M1-v9-cost150"
    assert not validator.is_valid(altered), "schema must reject unrelated/v9 responses"
    assert report["fixture_sha256"] == sha256(FIXTURE.read_bytes()).hexdigest()
    for metrics in (report["weekly"], report["daily_diagnostic_only"]):
        for result in metrics.values():
            assert (
                result["candidate_origins"]
                >= result["predicted_origins"]
                >= result["evaluated_origins"]
            )
            event = result["future_home_threshold_event"]
            assert (
                sum(event[k] for k in ("tp", "fp", "tn", "fn"))
                == result["evaluated_origins"]
            )
            assert (event["fpr"] is None) == (event["negative_n"] == 0)
            assert not result["clinical_performance_claim"]
    origins = [date.fromisoformat(o) for o in report["weekly_origins"]]
    assert all(b - a == timedelta(days=7) for a, b in pairwise(origins))
    assert report["subjects"] == 1 and not report["production_enabled"]
    published = base / "evidence/metrics.json"
    if published.exists():
        evidence = json.loads(published.read_text(encoding="utf-8"))
        assert evidence["weekly"] == report["weekly"]
        assert evidence["fixture_sha256"] == report["fixture_sha256"]
        for filename, digest in evidence["source_sha256"].items():
            assert sha256((base / filename).read_bytes()).hexdigest() == digest, (
                filename
            )
    print(
        json.dumps(
            {
                "response_contracts_verified": len(responses),
                "published_metrics_match": published.exists(),
                "production_enabled": False,
            }
        )
    )


if __name__ == "__main__":
    main()
