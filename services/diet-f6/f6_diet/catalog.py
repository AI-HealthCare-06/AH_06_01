"""F6 food-name matching and 100g nutrition, without its placeholder user/database models."""

import csv
import difflib
import math
import re
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
    return " ".join(name.split())


class Catalog:
    def __init__(self, directory: Path = DATA):
        self.foods = []
        with (directory / "food_nutrition_dev_sample.csv").open(
            encoding="utf-8-sig", newline=""
        ) as handle:
            for row in csv.DictReader(handle):
                if row["영양성분함량기준량"] != "100g":
                    raise ValueError("Only explicitly declared 100g data is supported")
                values = {}
                for key, label in FIELDS.items():
                    text = row.get(label, "").strip()
                    value = None if not text else float(text)
                    if value is not None and (not math.isfinite(value) or value < 0):
                        raise ValueError("Invalid nutrition source")
                    values[key] = value
                self.foods.append(
                    {
                        "food_code": row["식품코드"],
                        "name": row["식품명"],
                        "category": row["식품대분류명"],
                        "serving_g": float(
                            re.sub(r"[^0-9.]", "", row["식품중량"]) or 100
                        ),
                        "per_100g": values,
                    }
                )
        self.by_code = {food["food_code"]: food for food in self.foods}
        self.by_name = {food["name"]: food for food in self.foods}
        with (directory / "food_aliases.csv").open(
            encoding="utf-8-sig", newline=""
        ) as handle:
            self.aliases = {
                row["alias"]: row["food_name"] for row in csv.DictReader(handle)
            }

    def match(self, name: str) -> tuple[dict | None, str, dict | None]:
        name = normalized(name)
        candidates = list(
            dict.fromkeys(
                [
                    name,
                    re.sub(r"\s*\(.*?\)\s*", " ", name).strip(),
                    name.replace(" ", ""),
                ]
            )
        )
        for candidate in candidates:
            if candidate in self.by_name:
                return self.by_name[candidate], "exact", None
            if candidate in self.aliases and self.aliases[candidate] in self.by_name:
                return self.by_name[self.aliases[candidate]], "alias", None
        contained = [
            food
            for food in self.foods
            if food["name"].replace(" ", "") in name.replace(" ", "")
        ]
        if contained:
            suggestion = max(contained, key=lambda food: len(food["name"]))
        else:
            closest = difflib.get_close_matches(name, self.by_name, n=1, cutoff=0.45)
            suggestion = self.by_name[closest[0]] if closest else None
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
        }
