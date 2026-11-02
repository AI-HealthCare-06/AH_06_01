"""Record a fixed synthetic persona through the existing M1/M2 pipeline, without network or auth."""
from pathlib import Path
from datetime import date
import argparse
import hashlib
import json
import os
import sys

ROOT = Path(__file__).resolve().parents[3]
os.environ.setdefault("REXRUN_MODEL_SOURCE", str(ROOT / "ai/m1_stage"))
sys.path.insert(0, str(ROOT / "ai"))
from handler import predictor, saved_profile_input, with_input_gaps
from quest_analysis import demo_remote, analysis_response

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--date", required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()
    as_of = date.fromisoformat(args.date)
    remote = demo_remote(as_of, "studio-quarter-v1")
    m1 = with_input_gaps(predictor(), saved_profile_input(remote, as_of))
    result = analysis_response(m1, remote, synthetic=True, as_of=as_of)
    fixture = ROOT / "frontend/src/design/demo-persona-quarter.json"
    result["provenance"] = {"kind": "recorded-demo", "computedOn": args.date,
        "fixtureSha256": hashlib.sha256(fixture.read_bytes()).hexdigest(),
        "modelSha256": hashlib.sha256((ROOT / "ai/m1_stage/artifacts/20261020_150607/nested__base/model.pkl").read_bytes()).hexdigest()}
    Path(args.output).write_text(json.dumps(result, ensure_ascii=False, indent=2)+"\n", encoding="utf-8")
    print(json.dumps({"m1": result["m1"]["data_quality"], "m2": result["m2"]["data_quality"], "states": {k:v["status"] for k,v in result["m2"]["states"].items()}}))
