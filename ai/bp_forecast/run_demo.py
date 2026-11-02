"""Reproduce engineering evidence from synthetic data only. Run from repo root.

python -m ai.bp_forecast.run_demo --out .cache/bp-forecast-design
"""

from __future__ import annotations

import argparse
import json
from dataclasses import asdict, replace
from datetime import timedelta
from hashlib import sha256
from pathlib import Path

from .backtest import backtest
from .demo import ASSUMPTIONS, FIXTURE, demo_events
from .forecast import METHODS, forecast
from .history import ContextChange, day_end, snapshot


def scenario_events(events):
    end = max(e.measured_at.date() for e in events)
    return {
        "unchanged_video_persona": events,
        "sparse_every_third_day": [e for e in events if e.measured_at.day % 3 == 0],
        "morning_only": [e for e in events if e.slot == "morning"],
        "missing_last_four_days": [
            e for e in events if e.measured_at.date() <= end - timedelta(days=4)
        ],
        "clinic_only": [replace(e, setting="clinic") for e in events],
        "unknown_protocol": [replace(e, protocol_confirmed=False) for e in events],
        "date_unknown": [replace(e, measured_at=None) for e in events],
        "device_changed": [
            replace(e, device_id="new-synthetic-cuff")
            if e.measured_at.date() >= end - timedelta(days=4)
            else e
            for e in events
        ],
        "stable": [replace(e, systolic=130, diastolic=80) for e in events],
        "late_increase": [
            replace(e, systolic=e.systolic + 20, diastolic=e.diastolic + 10)
            if e.measured_at.date() >= end - timedelta(days=7)
            else e
            for e in events
        ],
        "noisy": [
            replace(
                e,
                systolic=e.systolic + ((e.measured_at.day * 7) % 17 - 8),
                diastolic=e.diastolic + ((e.measured_at.day * 3) % 9 - 4),
            )
            for e in events
        ],
        "single_extreme": [
            replace(e, systolic=350, diastolic=150) if e is events[-1] else e
            for e in events
        ],
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", type=Path, default=Path(".cache/bp-forecast-design"))
    parser.add_argument(
        "--save-aggregates",
        type=Path,
        help="Optional aggregate evidence destination; never copies origin-level rows",
    )
    args = parser.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)
    events = demo_events()
    start, end = (
        min(e.measured_at.date() for e in events),
        max(e.measured_at.date() for e in events),
    )
    evaluation_as_of = day_end(end + timedelta(days=2))
    # Fixed full 28-day lookback, then nonoverlapping seven-day target windows.
    weekly_origins = [
        start + timedelta(days=i) for i in range(27, (end - start).days - 6, 7)
    ]
    daily_origins = [
        start + timedelta(days=i) for i in range(27, (end - start).days - 6)
    ]
    weekly = backtest(events, events[0].subject_id, weekly_origins, evaluation_as_of)
    daily = backtest(events, events[0].subject_id, daily_origins, evaluation_as_of)
    scenarios = {}
    for name, values in scenario_events(events).items():
        history = snapshot(values, events[0].subject_id, day_end(end))
        scenarios[name] = {
            "forecast": forecast(history),
            "backtest": backtest(
                values, events[0].subject_id, weekly_origins, evaluation_as_of
            )["metrics"],
        }
    changed = snapshot(
        events,
        events[0].subject_id,
        day_end(end),
        [
            ContextChange(
                events[0].subject_id,
                day_end(end - timedelta(days=1)),
                day_end(end - timedelta(days=1)),
            )
        ],
    )
    scenarios["known_medication_change"] = {"forecast": forecast(changed)}
    current = snapshot(events, events[0].subject_id, day_end(end))
    report = {
        "scope": "synthetic_engineering_backtest_only",
        "clinical_performance_claim": False,
        "production_enabled": False,
        "subjects": 1,
        "observed_days": 90,
        "readings": len(events),
        "fixture_sha256": sha256(FIXTURE.read_bytes()).hexdigest(),
        "assumptions": ASSUMPTIONS,
        "policy": asdict(current.policy),
        "weekly_origins": [d.isoformat() for d in weekly_origins],
        "weekly_target_windows_overlap": False,
        "daily_target_windows_overlap": True,
        "weekly": weekly["metrics"],
        "daily_diagnostic_only": daily["metrics"],
        "weekly_common_evaluation_origins": weekly["common_evaluation_origins"],
        "weekly_common_cohort_metrics": weekly["common_cohort_metrics"],
        "current_research_forecasts": {m: forecast(current, m) for m in METHODS},
        "scenarios": scenarios,
        "model_selection": "none: never select/deploy using this scripted persona",
        "data_fitness": {
            "KNHANES_2013_2024": "cross-sectional inputs/labels, not daily within-person future targets",
            "app_snapshot": "latest overwritten JSON, no immutable per-measurement availability/revision history",
            "local_real_daily_forecast_cohort": "not identified; production patient database was not queried",
        },
    }
    (args.out / "results.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2, allow_nan=False) + "\n",
        encoding="utf-8",
    )
    (args.out / "weekly-origin-evidence.private.json").write_text(
        json.dumps(weekly["rows"], ensure_ascii=False, indent=2, allow_nan=False)
        + "\n",
        encoding="utf-8",
    )
    lines = [
        "# 혈압 이력 예측 설계 검증",
        "",
        "합성 시연 페르소나 1명 · 90일 · 180회. 임상 성능 검증이 아니다. 운영 모델은 선택하거나 교체하지 않았다.",
        "",
        "| 고정 대조군 | 주간 기점 수 | SBP MAE mmHg | DBP MAE mmHg | SBP 편향 mmHg |",
        "| --- | ---: | ---: | ---: | ---: |",
    ]
    for method, metric in weekly["metrics"].items():
        lines.append(
            f"| {method} | {metric['evaluated_origins']} | {metric['systolic']['mae_mmHg']:.3f} | {metric['diastolic']['mae_mmHg']:.3f} | {metric['systolic']['bias_mmHg']:.3f} |"
        )
    counts = weekly["metrics"]["mean_7d"]["future_home_threshold_event"]
    lines += [
        "",
        "대상 창은 겹치지 않지만 같은 사람이고 입력 창도 겹친다. 주간 기점 8개를 독립 환자 8명으로 해석하지 않는다. 일별 기점 비교는 겹치는 창을 사용하므로 보조 진단만 한다.",
        "",
        f"기본 시연의 미래 높은 평균 사건은 양성 {counts['positive_n']}개·음성 {counts['negative_n']}개다. 음성 분모가 없어 FPR은 null이며 오탐 감소를 입증할 수 없다. 기존 M1의 같은 방문 고혈압 분류와도 직접 비교하지 않는다.",
        "",
        "모든 대조군이 평가 가능한 공통 기점과 모델별 보류·정답 확보 분모를 별도로 보존한다.",
        "",
        "## 현재 기점",
        "",
        "다음 7일은 아직 관측되지 않았으므로 현재 기점의 오차·정확도는 평가하지 않는다. 예측 범위는 독립적인 실제 기록으로 보정되기 전까지 null이다.",
        "",
        "## 보류 시나리오",
        "",
    ]
    for name, result in scenarios.items():
        f = result["forecast"]
        lines.append(
            f"- {name}: {f['status']}"
            + (
                " · " + ", ".join(f["quality"]["reasons"])
                if f["quality"]["reasons"]
                else ""
            )
        )
    lines += [
        "",
        "## 재현",
        "",
        "```powershell",
        "python -m unittest discover -s ai/bp_forecast/tests -v",
        "python -m ai.bp_forecast.run_demo --out .cache/bp-forecast-design",
        "```",
        "",
        "08:00/20:00·수신 지연·기기·가정 측정·프로토콜 메타데이터는 시험을 위한 가정이다. 이를 실제 측정 메타데이터나 학습 데이터로 재사용하지 않는다.",
        "",
    ]
    (args.out / "summary.md").write_text("\n".join(lines), encoding="utf-8")
    if args.save_aggregates:
        base = Path(__file__).resolve().parent
        sources = (
            sorted(base.glob("*.py"))
            + sorted((base / "tests").glob("*.py"))
            + sorted(base.glob("*.json"))
        )
        aggregate_report = {
            "scope": report["scope"],
            "clinical_performance_claim": False,
            "production_enabled": False,
            "subjects": report["subjects"],
            "observed_days": report["observed_days"],
            "readings": report["readings"],
            "fixture_sha256": report["fixture_sha256"],
            "assumptions": ASSUMPTIONS,
            "source_sha256": {
                p.relative_to(base).as_posix(): sha256(p.read_bytes()).hexdigest()
                for p in sources
            },
            "weekly": report["weekly"],
            "weekly_origins": report["weekly_origins"],
            "weekly_common_evaluation_origins": report[
                "weekly_common_evaluation_origins"
            ],
            "weekly_common_cohort_metrics": report["weekly_common_cohort_metrics"],
            "scenarios": {
                name: {
                    "status": result["forecast"]["status"],
                    "reasons": result["forecast"]["quality"]["reasons"],
                }
                for name, result in scenarios.items()
            },
        }
        args.save_aggregates.mkdir(parents=True, exist_ok=True)
        (args.save_aggregates / "metrics.json").write_text(
            json.dumps(aggregate_report, ensure_ascii=False, indent=2, allow_nan=False)
            + "\n",
            encoding="utf-8",
        )
        (args.save_aggregates / "summary.md").write_text(
            "\n".join(lines)
            + "\n![합성 시연 데이터의 대조군 오차](baseline-mae.png)\n",
            encoding="utf-8",
        )
    print(
        json.dumps(
            {
                "out": str(args.out),
                "weekly_origins": len(weekly_origins),
                "daily_origins": len(daily_origins),
                "scenarios": len(scenarios),
                "production_enabled": False,
            }
        )
    )


if __name__ == "__main__":
    main()
