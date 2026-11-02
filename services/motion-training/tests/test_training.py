import sys
import copy
from pathlib import Path
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from train_sequence import validate_clip, split_subjects, fit, distance, resample


def clip(subject="P01", label="water", offset=0):
    return {
        "schemaVersion": 1,
        "featureVersion": "motion-sequence-v2",
        "subjectId": subject,
        "sessionId": f"{subject}-{offset}",
        "inputSource": "camera",
        "synthetic": False,
        "label": label,
        "frames": [
            {"t": i * 100, "values": [min(1, i / 32 + offset)] * 23} for i in range(32)
        ],
    }


def test_synthetic_and_unobserved_tools_cannot_train_real_medication_model():
    row = clip()
    row["synthetic"] = True
    with pytest.raises(ValueError, match="Synthetic"):
        validate_clip(row)
    with pytest.raises(ValueError, match="dedicated detector"):
        validate_clip(clip(label="insulin_pen"))


def test_subject_split_has_no_leakage_and_rejects_renamed_copies():
    rows = [
        validate_clip(clip(f"P{subject}", label, (subject * 10 + i) / 1000))
        for subject in range(3)
        for i, label in enumerate(
            ["water", "water", "negative", "negative", "negative"]
        )
    ]
    train, test = split_subjects(rows)
    assert not {r["subjectId"] for r in train} & {r["subjectId"] for r in test}
    duplicate = copy.deepcopy(rows[0])
    duplicate["subjectId"] = "P99"
    duplicate["sessionId"] = "renamed"
    with pytest.raises(ValueError, match="Duplicate recording"):
        split_subjects(rows + [duplicate])


def test_indistinguishable_labels_fail_calibration():
    rows = []
    for subject in ("P1", "P2"):
        for label in ("water", "negative"):
            for _ in range(2):
                rows.append(validate_clip(clip(subject, label)))
    with pytest.raises(ValueError, match="not separable"):
        fit(rows)


def test_invalid_sequence_and_timebase_are_rejected():
    row = clip()
    row["frames"][1]["t"] = 0
    with pytest.raises(ValueError, match="strictly increasing"):
        validate_clip(row)
    row = clip()
    row["frames"][0]["values"][0] = float("nan")
    with pytest.raises(ValueError, match="feature vector"):
        validate_clip(row)
    original = clip()["frames"]
    irregular = [original[i] for i in [0, 1, 15, 31]]
    assert distance(resample(original), resample(irregular)) < 1e-12
