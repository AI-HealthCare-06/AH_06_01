"""Vision LLM 출력 스키마. LLM은 '무엇이 얼마나'만 답하고 영양 수치는 내지 않는다."""

from pydantic import BaseModel, ConfigDict, Field, field_validator

MAX_FOODS = 12
MIN_GRAMS = 5
MAX_GRAMS = 1500


class VisionFood(BaseModel):
    model_config = ConfigDict(extra="ignore", allow_inf_nan=False)

    name: str = Field(min_length=1, max_length=30)
    in_candidates: bool = False
    estimated_g: float | None = None
    portion_hint: str | None = Field(default=None, max_length=50)
    confidence: float = Field(default=0.5, ge=0, le=1)
    is_soup: bool = False

    @field_validator("name")
    @classmethod
    def _strip(cls, v: str) -> str:
        value = " ".join(v.split())
        if not value:
            raise ValueError("Empty food name")
        return value

    @field_validator("estimated_g")
    @classmethod
    def _range(cls, v: float | None) -> float | None:
        # 범위 밖이면 None → 매칭된 DB의 1인분 중량으로 대체(설계서 3.3)
        if v is None or not (MIN_GRAMS <= v <= MAX_GRAMS):
            return None
        return round(v)


class VisionResult(BaseModel):
    model_config = ConfigDict(extra="ignore")

    is_food_photo: bool
    foods: list[VisionFood] = Field(default_factory=list)
    reason: str | None = None

    @field_validator("foods")
    @classmethod
    def _limit(cls, v: list[VisionFood]) -> list[VisionFood]:
        if len(v) > MAX_FOODS:
            v = sorted(v, key=lambda f: f.confidence, reverse=True)[:MAX_FOODS]
        return v
