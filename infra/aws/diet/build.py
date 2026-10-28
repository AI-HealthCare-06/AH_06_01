"""Package an explicit source allowlist; private environment files never enter ZIP."""

import hashlib
import json
import shutil
import zipfile
from pathlib import Path


def main():
    root = Path(__file__).resolve().parents[3]
    cache = root / ".cache/diet-f6"
    package = cache / "lambda-package"
    source = root / "services/diet-f6"
    for name in ["f6_diet", "data", "prompts"]:
        target = package / name
        target.mkdir(exist_ok=True)
        for path in (source / name).rglob("*"):
            if (
                path.is_file()
                and path.suffix in {".py", ".csv", ".md"}
                and "__pycache__" not in path.parts
            ):
                dest = target / path.relative_to(source / name)
                dest.parent.mkdir(parents=True, exist_ok=True)
                shutil.copyfile(path, dest)
    report = json.loads((cache / "lambda-pip-report.json").read_text(encoding="utf-8"))
    locked = sorted(
        f"{item['metadata']['name']}=={item['metadata']['version']}"
        for item in report["install"]
    )
    (source / "requirements-lambda-lock.txt").write_text("\n".join(locked) + "\n")
    zip_path = cache / "lambda.zip"
    count = 0
    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as archive:
        for path in sorted(package.rglob("*")):
            if (
                not path.is_file()
                or "__pycache__" in path.parts
                or path.suffix == ".pyc"
            ):
                continue
            relative = path.relative_to(package)
            public_ca = relative.as_posix() in {
                "botocore/cacert.pem",
                "certifi/cacert.pem",
            }
            if path.name.startswith(".env") or (
                not public_ca
                and path.suffix.lower()
                in {
                    ".pem",
                    ".key",
                    ".pfx",
                    ".keystore",
                }
            ):
                raise RuntimeError("Private file in deployment package")
            archive.write(path, relative.as_posix())
            count += 1
    data = zip_path.read_bytes()
    result = {
        "sha256": hashlib.sha256(data).hexdigest(),
        "bytes": len(data),
        "files": count,
        "privateEnvIncluded": False,
        "platform": "manylinux-x86_64-cp313",
    }
    (cache / "build.json").write_text(json.dumps(result, indent=2))
    print(json.dumps(result))


if __name__ == "__main__":
    main()
