"""Build the Python 3.12 x86 Lambda ZIP from Linux wheels in an isolated cache."""
from pathlib import Path
import hashlib
import json
import subprocess
import sys
import zipfile

ROOT = Path(__file__).resolve().parents[3]
CACHE = ROOT / ".cache/model-integration"
DEPENDENCIES = CACHE / "linux"
SOURCE = ROOT / "ai/m1_stage"
MODEL = "artifacts/20261020_150607/nested__base"

def main():
    CACHE.mkdir(parents=True, exist_ok=True)
    if not DEPENDENCIES.exists():
        subprocess.run([sys.executable, "-m", "pip", "install", "--only-binary=:all:",
            "--platform", "manylinux_2_28_x86_64", "--platform", "manylinux2014_x86_64",
            "--python-version", "3.12", "--implementation", "cp", "--target", str(DEPENDENCIES),
            "-r", str(Path(__file__).with_name("requirements.txt"))], check=True)
    entries = []
    for path in DEPENDENCIES.rglob("*"):
        relative = path.relative_to(DEPENDENCIES)
        if path.is_file() and not any(p in {"tests", "test", "__pycache__", "bin", "lightgbm", "lightgbm-4.6.0.dist-info"} for p in relative.parts):
            if path.suffix != ".pyc":
                entries.append((path, relative.as_posix()))
    for path in (SOURCE / "m1").rglob("*.py"):
        if "__pycache__" not in path.parts:
            entries.append((path, "m1_stage/" + path.relative_to(SOURCE).as_posix()))
    for relative in ["thresholds.py", "feature_contract.yaml"] + [str(p.relative_to(SOURCE)) for p in (SOURCE / MODEL).iterdir()]:
        entries.append((SOURCE / relative, "m1_stage/" + Path(relative).as_posix()))
    entries.append((Path(__file__).with_name("handler.py"), "handler.py"))
    entries.append((Path(__file__).with_name("quest_analysis.py"), "quest_analysis.py"))
    entries.append((ROOT / "frontend/src/design/demo-persona.json", "demo-persona.json"))
    entries.append((ROOT / "frontend/src/design/demo-persona-office-month.json", "demo-persona-office-month.json"))
    m2 = ROOT / "ai/m2_state"
    for relative in ("__init__.py", "thresholds.py", "feature_contract.py", "feature_contract.yaml", "rules_m2.py", "inference/__init__.py", "inference/judge_m2.py"):
        entries.append((m2 / relative, "m2_state/" + relative))
    entries.append((Path(__file__).with_name("daily_inputs.py"), "daily_inputs.py"))
    unpacked = sum(p.stat().st_size for p, _ in entries)
    if unpacked > 250 * 1024 * 1024:
        raise SystemExit(f"Lambda uncompressed limit exceeded: {unpacked}")
    target = CACHE / "bp-stage.zip"
    with zipfile.ZipFile(target, "w", zipfile.ZIP_DEFLATED) as bundle:
        for path, name in entries:
            if name == "m1_stage/m1/models/__init__.py":
                # Inference imports the original nested model directly; the training
                # candidate registry eagerly imports LightGBM, which is not deployed.
                bundle.writestr(name, '"""Pinned nested-model inference package; no training registry."""\n')
            else:
                bundle.write(path, name)
    report = {"zip": str(target), "sha256": hashlib.sha256(target.read_bytes()).hexdigest(),
        "compressedBytes": target.stat().st_size, "uncompressedBytes": unpacked,
        "runtime": "python3.12", "architecture": "x86_64", "model": "M1-20261020_150607-nested__base"}
    (CACHE / "build.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps(report))

if __name__ == "__main__":
    main()
