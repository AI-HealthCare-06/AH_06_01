"""Vision LLM 공통 인터페이스. 구현체는 VISION_PROVIDER 환경변수로 고른다."""

import re
from dataclasses import dataclass
from pathlib import Path
from typing import Protocol

_FENCE = re.compile(r"^```(?:json)?\s*|\s*```$", re.MULTILINE)


@dataclass(frozen=True)
class VisionRequest:
    image: bytes
    mime_type: str
    system_prompt: str
    user_prompt: str


class VisionProvider(Protocol):
    name: str
    model: str

    async def recognize(self, req: VisionRequest) -> str:
        """모델 원문 응답(JSON 문자열 기대)을 돌려준다. 파싱·검증은 호출자가 한다."""
        ...


class VisionProviderError(Exception):
    """API 오류(인증·한도·네트워크 등). 타임아웃은 asyncio.TimeoutError로 따로 처리한다."""


def strip_code_fence(text: str) -> str:
    return _FENCE.sub("", text.strip()).strip()


@dataclass(frozen=True)
class PromptTemplate:
    version: str
    system: str
    user: str

    @classmethod
    def load(cls, path: Path) -> "PromptTemplate":
        """프롬프트 파일: '## system' / '## user' 섹션. 버전은 파일명(diet_vision_v1)."""
        text = path.read_text(encoding="utf-8")
        parts = re.split(r"^## (system|user)\s*$", text, flags=re.MULTILINE)
        sections = {parts[i]: parts[i + 1].strip() for i in range(1, len(parts) - 1, 2)}
        return cls(version=path.stem, system=sections["system"], user=sections["user"])

    def render_user(self, candidates: list[str]) -> str:
        return self.user.replace("{food_candidates}", ", ".join(candidates))
