"""F6 food-name matching and 100g nutrition, without its placeholder user/database models."""

import csv
import difflib
import math
import json
import re
import unicodedata
from collections import defaultdict, Counter
from pathlib import Path

FIELDS = {
    "energy_kcal": "에너지(kcal)",
    "carb_g": "탄수화물(g)",
    "sugar_g": "당류(g)",
    "protein_g": "단백질(g)",
    "fat_g": "지방(g)",
    "sat_fat_g": "포화지방산(g)",
    "sodium_mg": "나트륨(mg)",
    "fiber_g": "식이섬유(g)",
    "potassium_mg": "칼륨(mg)",
    "cholesterol_mg": "콜레스테롤(mg)",
}
CATALOG_VERSION = "f6-dev-sample-v1"
DATA = Path(__file__).resolve().parent.parent / "data"


def normalized(name: str) -> str:
    return " ".join(unicodedata.normalize("NFKC", name).split())


def compact(name):
    return re.sub(r"[\s_(),·-]", "", normalized(name))


class Catalog:
    def __init__(self, directory: Path = DATA):
        self.foods = []
        official = (directory / "food_nutrition_mfds.csv").is_file()
        self.metadata = (
            json.loads((directory / "catalog-source.json").read_text(encoding="utf-8"))
            if official
            else {
                "version": "f6-dev-sample-v1",
                "kind": "development_sample",
                "publisher": "F6 개발용 예시",
                "source_url": "",
                "published_on": "",
            }
        )
        self.version = self.metadata["version"]
        filename = (
            "food_nutrition_mfds.csv" if official else "food_nutrition_dev_sample.csv"
        )
        with (directory / filename).open(encoding="utf-8-sig", newline="") as handle:
            for row in csv.DictReader(handle):
                if not official and row["영양성분함량기준량"] != "100g":
                    raise ValueError("Only explicitly declared 100g data is supported")
                values = {}
                for key, label in FIELDS.items():
                    text = row.get(key if official else label, "").strip()
                    value = None if not text else float(text)
                    if value is not None and (not math.isfinite(value) or value < 0):
                        raise ValueError("Invalid nutrition source")
                    values[key] = value
                self.foods.append(
                    {
                        "food_code": row["food_code" if official else "식품코드"],
                        "name": row["name" if official else "식품명"],
                        "category": row["category" if official else "식품대분류명"],
                        "serving_g": (
                            float(row["serving_g"]) if row.get("serving_g") else None
                        )
                        if official
                        else float(re.sub(r"[^0-9.]", "", row["식품중량"]) or 100),
                        "origin": row.get("origin", "개발용 예시"),
                        "source_date": row.get("source_date", ""),
                        "per_100g": values,
                    }
                )
        self.by_code = {food["food_code"]: food for food in self.foods}
        self.by_name = {}
        for food in self.foods:
            self.by_name.setdefault(compact(food["name"]), []).append(food)
        self.grams = defaultdict(set)
        for name in self.by_name:
            for i in range(max(0, len(name) - 1)):
                self.grams[name[i : i + 2]].add(name)
        with (directory / "food_aliases.csv").open(
            encoding="utf-8-sig", newline=""
        ) as handle:
            self.aliases = {
                row["alias"]: row["food_name"] for row in csv.DictReader(handle)
            }

    def match(self, name: str) -> tuple[dict | None, str, dict | None]:
        name = normalized(name)
        candidates = [compact(name)]
        alias = self.aliases.get(name)
        if alias:
            candidates.append(compact(alias))
        for candidate in candidates:
            if candidate in self.by_name:
                matches = self.by_name[candidate]
                if len(matches) == 1:
                    return (
                        matches[0],
                        "alias" if alias and candidate == compact(alias) else "exact",
                        None,
                    )
                # Different sources/preparations may share a name and nutrient values.
                # Let the user select the source rather than silently pick the last row.
                return None, "ambiguous", matches[0]
        key = compact(name)
        contained = [
            foods[0]
            for indexed, foods in self.by_name.items()
            if indexed in key or key in indexed
        ]
        if contained:
            suggestion = max(contained, key=lambda food: len(food["name"]))
        else:
            votes = Counter()
            for i in range(max(0, len(key) - 1)):
                votes.update(self.grams.get(key[i : i + 2], ()))
            pool = [name for name, _ in votes.most_common(100)]
            closest = difflib.get_close_matches(key, pool, n=1, cutoff=0.6)
            suggestion = self.by_name[closest[0]][0] if closest else None
        # A fuzzy suggestion must be explicitly selected. Do not assign a different food's nutrients.
        return None, "none", suggestion

    def item(self, food) -> dict:
        matched, match_type, suggested = self.match(food.name)
        grams = food.estimated_g
        # No invisible serving fallback: missing weight stays blank until the user supplies it.
        return {
            "name_input": food.name,
            "food_code": matched["food_code"] if matched else None,
            "name_final": matched["name"] if matched else food.name,
            "estimated_g": grams,
            "portion_hint": food.portion_hint,
            "confidence": food.confidence,
            "is_low_confidence": food.confidence < 0.5,
            "is_soup": food.is_soup,
            "match_type": match_type,
            "suggested_food_code": suggested["food_code"] if suggested else None,
            "serving_g": matched["serving_g"] if matched else None,
            "catalog_version": self.version,
            "source_name": self.metadata["publisher"],
            "source_date": matched["source_date"] if matched else None,
            "needs_confirmation": match_type != "exact"
            or food.confidence < 0.8
            or grams is None,
        }
