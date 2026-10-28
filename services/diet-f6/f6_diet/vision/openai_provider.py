import base64
from typing import Any

from .base import VisionProviderError, VisionRequest


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

        self.model = model or "gpt-4o-mini"
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
                        "image_url": {"url": f"data:{req.mime_type};base64,{b64}"},
                    },
                ],
            },
        ]
        try:
            resp = await self._client.chat.completions.create(
                model=self.model,
                temperature=openai.omit
                if self._temperature is None
                else self._temperature,
                response_format={"type": "json_object"},
                messages=messages,
            )
        except openai.OpenAIError as exc:
            raise VisionProviderError(type(exc).__name__) from exc
        return resp.choices[0].message.content or ""
