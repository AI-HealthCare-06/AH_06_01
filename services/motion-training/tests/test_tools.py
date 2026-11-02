import sys
import json
from pathlib import Path
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from train_tools import validate_dataset


def dataset(root):
    for split in ("train", "validation", "test"):
        folder = root / split
        (folder / "images").mkdir(parents=True)
        images = []
        annotations = []
        for i in range(31):
            filename = f"{i}.png"
            # Hash-only fixtures: no actual training or image decoding in validation tests.
            (folder / "images" / filename).write_bytes(f"fixture:{split}:{i}".encode())
            images.append(
                {
                    "id": i,
                    "file_name": filename,
                    "width": 100,
                    "height": 100,
                    "subject_id": f"{split}-{i % 2 if split == 'train' else 0}",
                    "synthetic": False,
                }
            )
            if i < 30:
                annotations.append(
                    {
                        "id": i,
                        "image_id": i,
                        "category_id": i % 3 + 1,
                        "bbox": [10, 10, 20, 20],
                    }
                )
        data = {
            "images": images,
            "annotations": annotations,
            "categories": [
                {"id": i + 1, "name": name}
                for i, name in enumerate(["pill", "insulin_pen", "syringe"])
            ],
        }
        (folder / "labels.json").write_text(json.dumps(data))


def edit(root, change):
    file = root / "test" / "labels.json"
    data = json.loads(file.read_text())
    change(data)
    file.write_text(json.dumps(data))


def test_requires_real_images_independent_participants_and_confusing_negatives(
    tmp_path,
):
    dataset(tmp_path)
    assert validate_dataset(tmp_path)["test"]["images"] == 31
    edit(tmp_path, lambda d: d["images"][0].update(synthetic=True))
    with pytest.raises(ValueError, match="real camera"):
        validate_dataset(tmp_path)


def test_prevents_subject_and_image_leakage(tmp_path):
    dataset(tmp_path)
    edit(tmp_path, lambda d: d["images"][0].update(subject_id="train-0"))
    with pytest.raises(ValueError, match="disjoint"):
        validate_dataset(tmp_path)
    edit(tmp_path, lambda d: d["images"][0].update(subject_id="test-0"))
    (tmp_path / "test/images/0.png").write_bytes(
        (tmp_path / "train/images/0.png").read_bytes()
    )
    with pytest.raises(ValueError, match="Duplicate image"):
        validate_dataset(tmp_path)


def test_rejects_external_images_and_out_of_bounds_annotations(tmp_path):
    dataset(tmp_path)
    edit(tmp_path, lambda d: d["images"][0].update(file_name="../../outside.png"))
    with pytest.raises(ValueError, match="inside"):
        validate_dataset(tmp_path)
    edit(tmp_path, lambda d: d["images"][0].update(file_name="0.png"))
    edit(tmp_path, lambda d: d["annotations"][0].update(bbox=[95, 95, 20, 20]))
    with pytest.raises(ValueError, match="outside image"):
        validate_dataset(tmp_path)
