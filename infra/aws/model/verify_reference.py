"""Synthetic serving checks against the pinned original model, never a training run."""
import json
import os
from pathlib import Path
import statistics
import time

ROOT = Path(__file__).resolve().parents[3]
os.environ["REXRUN_MODEL_SOURCE"] = str(ROOT / "ai/m1_stage")
from handler import predictor, saved_profile_input, with_input_gaps

sample = json.loads((ROOT / "ai/m1_stage/docs/sample_input.json").read_text(encoding="utf-8"))
model = predictor()
actual = model.predict(sample)
expected = {"normal": 0.1744, "elevated": 0.0901, "prehtn": 0.4187, "htn": 0.3168}
assert actual["stage_probs"] == expected
assert actual["stage_top"] == "prehtn" and actual["data_quality"] == "ok"
cases = [
    (dict(sample, age=95), "out_of_range"),
    (dict(sample, sbp=128), "not_applicable"),
    (dict(sample, htn_med=True), "not_applicable"),
    ({"age":52,"sex":"male","bmi":27.5}, "insufficient"),
    ({k:v for k,v in sample.items() if k != "waist_cm"}, "partial"),
]
for payload, quality in cases:
    result = model.predict(payload)
    assert result["data_quality"] == quality, result
    if quality not in ("ok", "partial"):
        assert result["stage_probs"] is None and result["stage_top"] is None
remote = {"health_profile":{"age":52,"sex":"male","height_cm":170,"weight_kg":75,
    "onboarding_bp_text":None,"fasting_glucose":102,"details":{
        "alcoholDays":0,"sleepHours":7,"activeMinutesWeek":150,"hypertensionFamily":False,"conditions":[]}},
    "medications":[]}
mapped = model.predict(saved_profile_input(remote))
assert mapped["data_quality"] == "partial", mapped
none = json.loads(json.dumps(remote))
none["health_profile"]["fasting_glucose"] = None
none["health_profile"]["details"].update(conditionStatus="none", alcoholDays=2)
incomplete = with_input_gaps(model, saved_profile_input(none))
assert incomplete["data_quality"] == "insufficient"
assert "diabetes_flag" not in incomplete["missing_inputs"]
assert "family_htn" not in incomplete["missing_inputs"]
assert set(incomplete["missing_inputs"]) == {"waist_cm", "alcohol_week", "fasting_glucose", "resting_hr", "education_years"}
none["health_profile"]["details"].update(waistCm=85, restingHeartRate=65, educationYears=12, alcoholWeek=8, bingeMonthly=False)
completed_input = saved_profile_input(none)
completed = with_input_gaps(model, completed_input)
assert completed["data_quality"] == "partial" and completed["stage_probs"] is not None
transformed = model.fast.transform(completed_input)
assert transformed.observed["family_htn"] and transformed.raw["family_htn"] == 0
assert transformed.observed["diabetes_flag"] and transformed.raw["diabetes_flag"] == 0
times=[]
for _ in range(200):
    start=time.perf_counter(); model.predict(sample); times.append((time.perf_counter()-start)*1000)
report={"syntheticOnly":True,"retrained":False,"referenceExampleMatched":True,
    "domainCases":len(cases),"savedProfileCase":mapped["data_quality"],
    "explicitNoneObserved":True,"missingInputsExplained":incomplete["missing_inputs"],
    "completedSurveyQuality":completed["data_quality"],"warmRuns":len(times),
    "warmP50Ms":statistics.median(times),"warmP95Ms":sorted(times)[int(.95*len(times))-1],
    "modelVersion":actual["model_version"],"sampleResult":actual}
(ROOT / ".cache/model-integration/reference-verification.json").write_text(json.dumps(report,indent=2),encoding="utf-8")
print(json.dumps(report))
