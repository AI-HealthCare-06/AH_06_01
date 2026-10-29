"""Offline, explicitly labelled COCO -> evaluated MediaPipe TFLite tool detector.

No data is uploaded. Optional Model Maker runs in a separate training environment.
Google no longer actively maintains Model Maker; pin that environment separately.
"""

import argparse
import collections
import hashlib
import json
import math
from pathlib import Path

LABELS = ["pill", "insulin_pen", "syringe"]


def validate_dataset(root):
    participants = {}
    hashes = set()
    stats = {}
    for split in ("train", "validation", "test"):
        folder = (root / split).resolve()
        data = json.loads((folder / "labels.json").read_text(encoding="utf-8"))
        categories = sorted(data["categories"], key=lambda c: c["id"])
        if [(r["id"], r["name"]) for r in categories] != list(enumerate(LABELS, 1)):
            raise ValueError(
                "COCO category IDs must be 1:pill, 2:insulin_pen, 3:syringe"
            )
        images = {}
        subjects = set()
        counts = collections.Counter()
        for image in data["images"]:
            subject = image.get("subject_id")
            if not isinstance(subject, str) or not subject or len(subject) > 40:
                raise ValueError("Each image needs an anonymous subject_id")
            if image.get("synthetic") is not False:
                raise ValueError("Explicit synthetic:false real camera images required")
            if image["id"] in images or image["width"] <= 0 or image["height"] <= 0:
                raise ValueError("Invalid or duplicate image ID/dimensions")
            file = (folder / "images" / image["file_name"]).resolve()
            if not file.is_relative_to(folder / "images") or not file.is_file():
                raise ValueError("Image must be inside the split's images folder")
            with file.open("rb") as handle:
                digest = hashlib.file_digest(handle, "sha256").hexdigest()
            if digest in hashes:
                raise ValueError(
                    "Duplicate image across dataset; prevent train/test leakage"
                )
            hashes.add(digest)
            images[image["id"]] = image
            subjects.add(subject)
        if any(subjects & existing for existing in participants.values()):
            raise ValueError(
                "Training, validation and test participants must be disjoint"
            )
        if len(subjects) < (2 if split == "train" else 1):
            raise ValueError(
                "Use two training participants plus separate validation/test participants"
            )
        annotation_ids = set()
        for annotation in data["annotations"]:
            image = images.get(annotation["image_id"])
            box = annotation.get("bbox", [])
            if (
                annotation["id"] in annotation_ids
                or not image
                or annotation["category_id"] not in (1, 2, 3)
            ):
                raise ValueError("Invalid or duplicate annotation")
            if len(box) != 4 or any(
                not isinstance(v, (int, float)) or not math.isfinite(v) for v in box
            ):
                raise ValueError("COCO boxes need finite pixel x,y,width,height")
            x, y, w, h = box
            if (
                min(x, y) < 0
                or min(w, h) <= 0
                or x + w > image["width"]
                or y + h > image["height"]
            ):
                raise ValueError("Box outside image")
            counts[annotation["category_id"]] += 1
            annotation_ids.add(annotation["id"])
        if any(counts[label] < (10 if split == "train" else 5) for label in (1, 2, 3)):
            raise ValueError(
                "Need at least 10 training / 5 validation-test boxes per tool"
            )
        if split == "test" and len(images) < 20:
            raise ValueError(
                "At least 20 independent test images including negatives required"
            )
        labelled = {a["image_id"] for a in data["annotations"]}
        if not set(images) - labelled:
            raise ValueError("Include confusing negatives with no target tool")
        participants[split] = subjects
        stats[split] = {
            "subjects": len(subjects),
            "images": len(images),
            "boxes": dict(counts),
        }
    return stats


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("dataset", type=Path)
    parser.add_argument("--output", type=Path)
    parser.add_argument("--validate-only", action="store_true")
    args = parser.parse_args()
    stats = validate_dataset(args.dataset)
    if args.validate_only:
        print(json.dumps(stats))
        return
    if not args.output or args.output.exists():
        parser.error("Choose a new --output directory")
    # Documented API: https://developers.google.com/edge/mediapipe/solutions/customization/object_detector
    from mediapipe_model_maker import object_detector

    options = object_detector.ObjectDetectorOptions(
        supported_model=object_detector.SupportedModels.MOBILENET_MULTI_AVG,
        hparams=object_detector.HParams(export_dir=str(args.output)),
    )
    datasets = {
        split: object_detector.Dataset.from_coco_folder(
            str(args.dataset / split), cache_dir=str(args.output / "cache" / split)
        )
        for split in stats
    }
    model = object_detector.ObjectDetector.create(
        train_data=datasets["train"],
        validation_data=datasets["validation"],
        options=options,
    )
    _, metrics = model.evaluate(datasets["test"], batch_size=4)
    report = {
        "AP": float(metrics["AP"]),
        "dataset": stats,
        "evaluation": "participant-disjoint untouched test set",
    }
    args.output.mkdir(parents=True, exist_ok=True)
    (args.output / "evaluation.json").write_text(
        json.dumps(report, indent=2), encoding="utf-8"
    )
    if not math.isfinite(report["AP"]) or report["AP"] < 0.5:
        raise SystemExit("Independent AP gate failed; no validated manifest exported")
    model.export_model()
    original = args.output / "model.tflite"
    digest = hashlib.sha256(original.read_bytes()).hexdigest()
    output = args.output / f"tool-{digest[:12]}.tflite"
    output.write_bytes(original.read_bytes())
    manifest = {
        "schemaVersion": 1,
        "validated": True,
        "file": output.name,
        "sha256": digest,
        "labels": LABELS,
        "evaluation": {
            "trainSubjects": stats["train"]["subjects"],
            "evaluationSubjects": stats["test"]["subjects"],
            "images": stats["test"]["images"],
            "AP": report["AP"],
        },
    }
    (args.output / "tool-model.json").write_text(
        json.dumps(manifest, indent=2), encoding="utf-8"
    )
    print(json.dumps({"model": str(output), "AP": report["AP"]}))


if __name__ == "__main__":
    main()
