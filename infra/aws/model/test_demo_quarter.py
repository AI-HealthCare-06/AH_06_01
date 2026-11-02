"""The real local model packages share a process without sharing their thresholds."""
from datetime import date
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "ai"))


def test_quarter_persona_runs_both_models_without_inventing_an_m1_prediction():
    import handler
    from quest_analysis import demo_remote, analysis_response
    remote = demo_remote(date(2026, 11, 2), "studio-quarter-v1")
    assert len(remote["game"]["dailySurveys"]) == 90
    m1 = handler.with_input_gaps(handler.predictor(), handler.saved_profile_input(remote, date(2026, 11, 2)))
    assert m1["data_quality"] == "not_applicable"
    assert m1["stage_probs"] is None
    result = analysis_response(m1, remote, synthetic=True, as_of=date(2026, 11, 2))
    assert result["m2"]["data_quality"] == "ok"
    assert result["m2"]["states"]["NOCTURNAL_SCREEN"]["status"] == "positive"
    import m2_state.thresholds as m2_thresholds
    assert sys.modules["thresholds"] is not m2_thresholds
    assert handler.with_input_gaps(handler.predictor(), handler.saved_profile_input(remote, date(2026, 11, 2))) == m1
