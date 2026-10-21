"""
[파일] m1/contract.py
[용도] feature_contract.yaml 을 읽어 파이썬 객체(Contract, FeatureSpec)로 만들고, 모델 입력 열 순서, 단조 방향 벡터,
      결측 플래그 소유 피처, 혈압 컬럼 차단 검사를 제공한다.
[왜 필요한가] 명세 1절: 피처 이름·타입·단위·범위·결측 처리·단조 방향의 원본은 yaml 한 파일이다. 코드가 yaml 을 해석하는 창구를 하나로 두어야
             학습과 추론이 같은 열 순서·같은 제약을 쓴다. 혈압 관련 컬럼(sbp, dbp, 혈압 등)이 피처에 섞이면 여기서 즉시 오류를 낸다.
[쓰는 곳] m1/features.py, m1/labels.py, m1/predict.py, train.py, profile_data.py, tests/
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable

import yaml

ROOT = Path(__file__).resolve().parent.parent
CONTRACT_PATH = ROOT / "feature_contract.yaml"


@dataclass(frozen=True)
class FeatureSpec:
    name: str
    type: str                      # int | float | bool | category
    missing: dict                  # {method: reject|median|median_by_sex_bmi_bin|constant|derived, value?, flag?}
    monotone: int                  # 1 상승, -1 하강, 0 제약 없음
    range: tuple[float, float] | None = None
    values: tuple[str, ...] | None = None
    aliases: dict | None = None
    encoding: dict | None = None
    optional: bool = False

    @property
    def flag(self) -> str | None:
        return self.missing.get("flag")

    @property
    def method(self) -> str:
        return str(self.missing.get("method", "reject"))

    @property
    def is_numeric(self) -> bool:
        return self.type in ("int", "float")


def _spec(d: dict, optional: bool = False) -> FeatureSpec:
    rng = d.get("range")
    return FeatureSpec(
        name=str(d["name"]),
        type=str(d["type"]),
        missing=dict(d.get("missing") or {"method": "reject"}),
        monotone=int(d.get("monotone", 0)),
        range=(float(rng[0]), float(rng[1])) if rng else None,
        values=tuple(str(v) for v in d["values"]) if d.get("values") else None,
        aliases=d.get("aliases"),
        encoding=d.get("encoding"),
        optional=optional,
    )


class Contract:
    """feature_contract.yaml 의 파이썬 표현."""

    def __init__(self, raw: dict):
        self.version = str(raw["version"])
        self.forbidden_patterns = [str(p) for p in raw["forbidden_feature_patterns"]]
        self.label_inputs = dict(raw["label_inputs"])
        self.features = [_spec(f) for f in raw["features"]]
        self.optional_features = [_spec(f, optional=True) for f in raw.get("optional_features") or []]
        self.interactions = [str(i["name"]) for i in raw.get("interactions") or []]
        self.missing_flags_as_features = bool(raw.get("missing_flags_as_features", True))
        self.standardize = [str(c) for c in raw.get("standardize") or []]
        names = [f.name for f in self.all_features()]
        if len(names) != len(set(names)):
            raise ValueError("feature_contract.yaml: 피처 이름이 중복됨")

    @classmethod
    def load(cls, path: Path | str = CONTRACT_PATH) -> "Contract":
        with open(path, encoding="utf-8") as fh:
            return cls(yaml.safe_load(fh))

    def all_features(self) -> list[FeatureSpec]:
        return self.features + self.optional_features

    def selected_features(self, optional: Iterable[str] = ()) -> list[FeatureSpec]:
        opt = set(optional)
        unknown = opt - {f.name for f in self.optional_features}
        if unknown:
            raise KeyError(f"알 수 없는 선택 피처: {sorted(unknown)}")
        return self.features + [f for f in self.optional_features if f.name in opt]

    def required_features(self) -> list[FeatureSpec]:
        return [f for f in self.features if f.method == "reject"]

    def base_flags(self) -> list[str]:
        return list(dict.fromkeys(f.flag for f in self.features if f.flag))

    def flag_owner(self, optional: Iterable[str] = ()) -> dict[str, str]:
        """플래그 → 그 플래그를 세우는 피처(yaml 에서 먼저 선언한 피처). 같은 플래그를 공유하는 뒤 피처는 세우지 않는다."""
        owner: dict[str, str] = {}
        for f in self.selected_features(optional):
            if f.flag:
                owner.setdefault(f.flag, f.name)
        return owner

    def model_columns(self, optional: Iterable[str] = ()) -> list[str]:
        cols = [f.encoding["column"] if f.type == "category" else f.name for f in self.features]
        cols += self.interactions
        if self.missing_flags_as_features:
            cols += self.base_flags()
        for f in self.selected_features(optional):
            if not f.optional:
                continue
            cols += list(f.encoding["dummies"]) if f.type == "category" else [f.name]
            if self.missing_flags_as_features and f.flag:
                cols.append(f.flag)
        self.check_forbidden(cols)
        return cols

    def monotone_vector(self, columns: Iterable[str]) -> list[int]:
        mono = {f.name: f.monotone for f in self.all_features() if f.type != "category"}
        return [mono.get(c, 0) for c in columns]

    def is_forbidden(self, column: str) -> bool:
        lc = str(column).lower()
        return any(re.search(p, lc) for p in self.forbidden_patterns)

    def check_forbidden(self, columns: Iterable[str]) -> None:
        bad = [c for c in columns if self.is_forbidden(c)]
        if bad:
            raise ValueError(f"혈압 관련 컬럼은 M1 피처로 쓸 수 없다: {bad}")
