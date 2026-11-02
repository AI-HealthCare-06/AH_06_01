import asyncio
import io
import json
from types import SimpleNamespace
import pytest
from PIL import Image
from f6_diet.catalog import Catalog
from f6_diet.recognition import recognize_meal, crop_food
from f6_diet.vision.base import VisionRequest, VisionProviderError
from f6_diet.vision.openai_provider import OpenAIVisionProvider


def image():
    output = io.BytesIO()
    Image.new("RGB", (512, 512), "white").save(output, format="JPEG")
    return output.getvalue()


def request():
    return VisionRequest(
        image(), "image/jpeg", "음식 식별. 영양 추측 금지", "음식을 확인해 줘"
    )


def test_official_reference_keeps_mass_basis_and_missing_values():
    catalog = Catalog()
    assert len(catalog.foods) == 13954
    assert catalog.metadata["excluded_basis"]["100ml"] == 5784
    rice = catalog.by_code["D301-022000000-0001"]
    assert rice["per_100g"]["energy_kcal"] == 166
    assert "D406-266000000-0001" not in catalog.by_code
    assert all(f["food_code"].startswith("D") for f in catalog.foods)


def test_crop_review_is_bounded_and_never_reestimates_physical_portion():
    class Provider:
        model = "test"
        calls = 0

        async def recognize(self, value):
            self.calls += 1
            foods = (
                [
                    {
                        "name": f"모르는 음식 {i}",
                        "confidence": 0.4,
                        "estimated_g": 350,
                        "bbox": [0.1, 0.1, 0.7, 0.7],
                    }
                    for i in range(5)
                ]
                if self.calls == 1
                else [{"name": "김치찌개", "confidence": 0.95, "estimated_g": 20}]
            )
            return json.dumps({"is_food_photo": True, "foods": foods})

    provider = Provider()
    result, passes, warnings, reviewed = asyncio.run(
        recognize_meal(provider, request(), Catalog())
    )
    assert provider.calls == 3 and len(passes) == 3 and len(reviewed) == 2
    assert not warnings and result.foods[0].estimated_g == 350
    assert result.foods[0].confidence == 0.4
    assert crop_food(image(), [0.1, 0.1, 0.11, 0.11]) is None


def test_optional_review_failure_preserves_initial_data_with_visible_warning():
    class Provider:
        model = "test"
        calls = 0

        async def recognize(self, value):
            self.calls += 1
            if self.calls > 1:
                raise VisionProviderError("Unavailable")
            return json.dumps(
                {
                    "is_food_photo": True,
                    "foods": [
                        {
                            "name": "모르는 음식",
                            "confidence": 0.3,
                            "estimated_g": None,
                            "bbox": [0.1, 0.1, 0.6, 0.6],
                        }
                    ],
                }
            )

    result, passes, warnings, reviewed = asyncio.run(
        recognize_meal(Provider(), request(), Catalog())
    )
    assert result.foods[0].estimated_g is None
    assert len(passes) == 2 and warnings and not reviewed


def test_provider_sends_closed_schema_high_detail_and_a_token_bound():
    calls = []

    class Completions:
        async def create(self, **options):
            calls.append(options)
            return SimpleNamespace(
                choices=[
                    SimpleNamespace(
                        finish_reason="stop",
                        message=SimpleNamespace(
                            content='{"is_food_photo":false,"foods":[],"reason":null}',
                            refusal=None,
                        ),
                    )
                ]
            )

    provider = OpenAIVisionProvider("test-key-not-sent", "gpt-5.4-mini")
    original = provider._client
    provider._client = SimpleNamespace(chat=SimpleNamespace(completions=Completions()))

    async def run():
        try:
            await provider.recognize(request())
        finally:
            await original.close()

    asyncio.run(run())
    body = calls[0]
    assert body["response_format"]["type"] == "json_schema"
    assert body["response_format"]["json_schema"]["strict"] is True
    assert (
        body["response_format"]["json_schema"]["schema"]["additionalProperties"]
        is False
    )
    assert body["messages"][1]["content"][1]["image_url"]["detail"] == "high"
    assert body["max_completion_tokens"] == 2400 and body["reasoning_effort"] == "none"
