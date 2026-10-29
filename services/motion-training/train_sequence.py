"""Supervised, bounded DTW prototype classifier. No real clips -> no shipped model.

Input is the explicit feature export from /cv, not raw video or an automatic event label.
"""

import argparse
import collections
import hashlib
import json
import math
from pathlib import Path

LABELS = ("water", "oral", "insulin_pen", "syringe", "negative")
FEATURE_VERSION = "motion-sequence-v2"


def resample(frames, count=32):
    first, last = frames[0]["t"], frames[-1]["t"]
    index = 0
    result = []
    for i in range(count):
        time = first + (last - first) * i / (count - 1)
        while index < len(frames) - 2 and frames[index + 1]["t"] < time:
            index += 1
        a, b = frames[index : index + 2]
        ratio = (time - a["t"]) / (b["t"] - a["t"]) if b["t"] > a["t"] else 0
        result.append(
            [v + (b["values"][k] - v) * ratio for k, v in enumerate(a["values"])]
        )
    return result


def distance(a, b):
    previous = [0] + [math.inf] * len(b)
    for i, x in enumerate(a, 1):
        current = [math.inf] * (len(b) + 1)
        for j in range(max(1, i - 8), min(len(b), i + 8) + 1):
            cost = sum(abs(v - b[j - 1][k]) for k, v in enumerate(x)) / 23
            current[j] = cost + min(previous[j], current[j - 1], previous[j - 1])
        previous = current
    return previous[-1] / max(len(a), len(b))


def validate_clip(raw):
    row = raw.get("trainingExample", raw)
    if row.get("schemaVersion") != 1 or row.get("featureVersion") != FEATURE_VERSION:
        raise ValueError("Export a labelled feature recording from /cv")
    if row.get("inputSource") != "camera" or row.get("synthetic") is not False:
        raise ValueError("Synthetic/sample clips are never real training data")
    if (
        row.get("label") not in LABELS
        or not row.get("subjectId")
        or not row.get("sessionId")
    ):
        raise ValueError(
            "An anonymous participant, session, and manual ground-truth label are required"
        )
    frames = row.get("frames", [])
    if not 20 <= len(frames) <= 900:
        raise ValueError("A clip needs 20..900 observed frames")
    last = -1
    for frame in frames:
        time = frame.get("t")
        values = frame.get("values", [])
        if (
            not isinstance(time, (int, float))
            or not math.isfinite(time)
            or not last < time <= 65000
        ):
            raise ValueError("Frame times must be finite and strictly increasing")
        if len(values) != 23 or any(
            isinstance(v, bool)
            or not isinstance(v, (int, float))
            or not math.isfinite(v)
            or not 0 <= v <= 1
            for v in values
        ):
            raise ValueError("Unexpected normalized feature vector")
        last = time
    if frames[-1]["t"] - frames[0]["t"] < 1800:
        raise ValueError("Record a complete process, at least 1.8 seconds")
    if row["label"] in ("oral", "insulin_pen", "syringe") and not any(
        f["values"][15] == 1 for f in frames
    ):
        raise ValueError(
            "Medication/tool sequence training requires actual dedicated detector evidence first"
        )
    return {**row, "values": resample(frames)}


def percentile(values, p):
    values = sorted(values)
    position = (len(values) - 1) * p
    left = int(position)
    right = min(left + 1, len(values) - 1)
    return values[left] + (values[right] - values[left]) * (position - left)


def split_subjects(clips):
    subjects = sorted({r["subjectId"] for r in clips})
    if len(subjects) < 3:
        raise ValueError(
            "At least three distinct participants are needed: two train, one independent evaluation"
        )
    holdout = set(subjects[-max(1, round(len(subjects) * 0.25)) :])
    train = [r for r in clips if r["subjectId"] not in holdout]
    evaluation = [r for r in clips if r["subjectId"] in holdout]
    seen = {}
    for row in clips:
        digest = hashlib.sha256(
            json.dumps(row["frames"], sort_keys=True, separators=(",", ":")).encode()
        ).hexdigest()
        if digest in seen:
            raise ValueError(
                "Duplicate recording detected; do not relabel or copy a clip across subjects"
            )
        seen[digest] = row["subjectId"]
    if len(evaluation) < 5:
        raise ValueError("Independent evaluation needs at least five clips")
    labels = {r["label"] for r in train}
    if "negative" not in labels or len(labels) < 2:
        raise ValueError("Both intended and confusing/negative actions are required")
    if not labels <= {r["label"] for r in evaluation}:
        raise ValueError("Every trained label needs independent evaluation clips")
    return train, evaluation


def fit(train):
    prototypes = []
    groups = collections.defaultdict(list)
    for row in train:
        groups[(row["label"], row["subjectId"])].append(row)
    for (label, subject), rows in sorted(groups.items()):
        if len(rows) < 2:
            raise ValueError(
                "Record at least two sessions/examples per participant and label"
            )
        candidates = rows[:10]
        chosen = min(
            candidates,
            key=lambda r: sum(
                distance(r["values"], other["values"]) for other in candidates
            ),
        )
        prototypes.append(
            {"label": label, "subject": subject, "values": chosen["values"]}
        )
    if len(prototypes) > 24:
        raise ValueError(
            "This mobile classifier supports at most 24 participant/label prototypes"
        )
    thresholds = {}
    for label in LABELS:
        selected = [p for p in prototypes if p["label"] == label]
        if not selected:
            thresholds[label] = {"maxDistance": 0.0001, "minMargin": 1}
            continue
        positive = []
        negative = []
        for row in train:
            eligible = [p for p in selected if p["subject"] != row["subjectId"]]
            if not eligible:
                continue
            nearest = min(distance(row["values"], p["values"]) for p in eligible)
            (positive if row["label"] == label else negative).append(nearest)
        if not positive or not negative:
            raise ValueError(
                "Each label needs cross-participant positives and negatives"
            )
        upper = percentile(positive, 0.95)
        lower = percentile(negative, 0.05)
        if upper >= lower:
            raise ValueError(
                f"{label}: intended and confusing actions are not separable; collect better evidence"
            )
        thresholds[label] = {
            "maxDistance": max(0.0001, (upper + lower) / 2),
            "minMargin": max(0.001, (lower - upper) / 4),
        }
    return {
        "schemaVersion": 1,
        "featureVersion": FEATURE_VERSION,
        "prototypes": [
            {"label": p["label"], "values": p["values"]} for p in prototypes
        ],
        "thresholds": thresholds,
    }


def predict(model, values):
    scores = []
    for label in LABELS:
        items = [
            distance(values, p["values"])
            for p in model["prototypes"]
            if p["label"] == label
        ]
        scores.append((min(items) if items else math.inf, label))
    scores.sort()
    best, label = scores[0]
    next_best = scores[1][0]
    policy = model["thresholds"][label]
    return (
        label
        if best <= policy["maxDistance"] and next_best - best >= policy["minMargin"]
        else "uncertain"
    )


def evaluate(model, clips):
    matrix = collections.Counter(
        (r["label"], predict(model, r["values"])) for r in clips
    )
    rows = {}
    for label in sorted({r["label"] for r in clips}):
        tp = matrix[label, label]
        fp = sum(
            n
            for (actual, pred), n in matrix.items()
            if pred == label and actual != label
        )
        fn = sum(
            n
            for (actual, pred), n in matrix.items()
            if actual == label and pred != label
        )
        precision = tp / (tp + fp) if tp + fp else 0
        recall = tp / (tp + fn) if tp + fn else 0
        rows[label] = {
            "precision": precision,
            "recall": recall,
            "f1": 2 * precision * recall / (precision + recall)
            if precision + recall
            else 0,
            "support": tp + fn,
        }
    return {
        "perLabel": rows,
        "macroF1": sum(v["f1"] for v in rows.values()) / len(rows),
        "confusion": [
            {"actual": a, "predicted": p, "count": n}
            for (a, p), n in sorted(matrix.items())
        ],
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input", type=Path)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    files = sorted(args.input.glob("*.json"))
    if not files:
        parser.error("No real labelled feature exports; no model has been generated")
    clips = []
    for file in files:
        if file.stat().st_size > 2_000_000:
            parser.error("Clip export exceeds 2 MB")
        clips.append(validate_clip(json.loads(file.read_text(encoding="utf-8"))))
    train, evaluation = split_subjects(clips)
    model = fit(train)
    report = evaluate(model, evaluation)
    if args.output.exists():
        raise FileExistsError(
            "Use a new output directory; preserve previous model and evaluation"
        )
    args.output.mkdir(parents=True)
    (args.output / "evaluation.json").write_text(
        json.dumps(report, indent=2), encoding="utf-8"
    )
    if report["macroF1"] < 0.8 or any(
        v["precision"] < 0.9 for k, v in report["perLabel"].items() if k != "negative"
    ):
        raise SystemExit(
            "Independent quality gate failed. Evaluation saved; model not activated."
        )
    model["training"] = {
        "synthetic": False,
        "trainSubjects": len({r["subjectId"] for r in train}),
        "evaluationSubjects": len({r["subjectId"] for r in evaluation}),
        "evaluationClips": len(evaluation),
        "macroF1": report["macroF1"],
        "minPositivePrecision": min(
            v["precision"] for k, v in report["perLabel"].items() if k != "negative"
        ),
    }
    output = args.output / "sequence-model.json"
    if output.exists():
        raise FileExistsError(
            "Use a fresh output directory to preserve the previous model"
        )
    output.write_text(json.dumps(model, separators=(",", ":")), encoding="utf-8")
    print(
        json.dumps(
            {
                "model": str(output),
                "trainClips": len(train),
                "evaluationClips": len(evaluation),
                "macroF1": report["macroF1"],
            }
        )
    )


if __name__ == "__main__":
    main()
