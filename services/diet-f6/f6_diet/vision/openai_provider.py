import base64
from typing import Any

from .base import VisionProviderError, VisionRequest


def response_schema():
    """Explicit closed schema; every property is required, unknown values are null."""
    food = {
        "type": "object",
        "additionalProperties": False,
        "properties": {
            "name": {"type": "string"},
            "in_candidates": {"type": "boolean"},
            "estimated_g": {"type": ["number", "null"]},
            "portion_hint": {"type": ["string", "null"]},
            "confidence": {"type": "number", "minimum": 0, "maximum": 1},
            "is_soup": {"type": "boolean"},
            "bbox": {
                "anyOf": [
                    {
                        "type": "array",
                        "items": {"type": "number", "minimum": 0, "maximum": 1},
                        "minItems": 4,
                        "maxItems": 4,
                    },
                    {"type": "null"},
                ]
            },
        },
    }
    food["required"] = list(food["properties"])
    return {
        "type": "object",
        "additionalProperties": False,
        "properties": {
            "is_food_photo": {"type": "boolean"},
            "foods": {"type": "array", "items": food, "maxItems": 12},
            "reason": {"type": ["string", "null"]},
        },
        "required": ["is_food_photo", "foods", "reason"],
    }


class OpenAIVisionProvider:
    """OpenAI 및 OpenAI 호환 엔드포인트(VISION_BASE_URL)용."""

    name = "openai"

    def __init__(
        self,
        api_key: str,
        model: str,
        base_url: str | None = None,
        temperature: float = 0.0,
    ) -> None:
        from openai import AsyncOpenAI

        self.model = model or "gpt-4o"
        self._temperature: float | None = temperature if temperature >= 0 else None
        self._client = AsyncOpenAI(
            api_key=api_key, base_url=base_url or None, max_retries=0
        )

    async def recognize(self, req: VisionRequest) -> str:
        import openai

        b64 = base64.b64encode(req.image).decode()
        messages: list[Any] = [
            {"role": "system", "content": req.system_prompt},
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": req.user_prompt},
                    {
                        "type": "image_url",
                        "image_url": {
                            "url": f"data:{req.mime_type};base64,{b64}",
                            "detail": req.detail,
                        },
                    },
                ],
            },
        ]
        try:
            options = {}
            if self.model.startswith(("gpt-5", "gpt-6")):
                options["reasoning_effort"] = (
                    "none" if not self.model.startswith("gpt-5-mini") else "minimal"
                )
            resp = await self._client.chat.completions.create(
                model=self.model,
                temperature=openai.omit
                if self._temperature is None or options
                else self._temperature,
                response_format={
                    "type": "json_schema",
                    "json_schema": {
                        "name": "meal_vision_v3",
                        "strict": True,
                        "schema": response_schema(),
                    },
                },
                max_completion_tokens=req.max_output_tokens,
                messages=messages,
                **options,
            )
        except openai.OpenAIError as exc:
            raise VisionProviderError(type(exc).__name__) from exc
        choice = resp.choices[0]
        if choice.finish_reason == "length" or choice.message.refusal:
            raise VisionProviderError("IncompleteOutput")
        return choice.message.content or ""
