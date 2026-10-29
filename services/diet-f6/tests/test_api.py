import asyncio
import io
import json

from f6_diet.api import Settings, create_app, normalize_image
from f6_diet.catalog import Catalog
from fastapi.testclient import TestClient
from PIL import Image


class Provider:
    name = "test-double"
    model = "test-not-a-real-model"

    def __init__(self, result=None):
        self.calls = 0
        self.result = result or {
            "is_food_photo": True,
            "foods": [{"name": "공기밥", "estimated_g": 210, "confidence": 0.9}],
        }

    async def recognize(self, request):
        self.calls += 1
        assert request.mime_type == "image/jpeg"
        assert "영양" in request.system_prompt
        return json.dumps(self.result)


def settings(**values):
    return Settings(
        local=True,
        api_key="",
        model="test",
        base_url=None,
        origins=["http://127.0.0.1:5173"],
        supabase_url="",
        publishable_key="",
        **values,
    )


def photo():
    output = io.BytesIO()
    Image.new("RGB", (20, 20), "green").save(output, format="PNG")
    return output.getvalue()


def post(client, data=None, image=None, headers=None):
    return client.post(
        "/api/diet/analyze",
        data=data or {"ai_consent": "true"},
        files={"photo": ("meal.png", image or photo(), "image/png")},
        headers=headers
        or {"Origin": "http://127.0.0.1:5173", "X-REXRUN-Development": "1"},
    )


def test_consent_and_origin_gate_before_model_call():
    provider = Provider()
    with TestClient(create_app(settings(), provider)) as client:
        assert post(client, {"ai_consent": "false"}).status_code == 400
        assert (
            post(
                client,
                headers={
                    "Origin": "https://untrusted.example",
                    "X-REXRUN-Development": "1",
                },
            ).status_code
            == 403
        )
        assert (
            post(client, headers={"Origin": "http://127.0.0.1:5173"}).status_code == 401
        )
    assert provider.calls == 0


def test_real_result_provenance_and_alias_matching():
    with TestClient(create_app(settings(), Provider())) as client:
        result = post(client)
    assert result.status_code == 200
    data = result.json()
    assert data["source"] == "vision"
    assert data["catalog_kind"] == "official_mfds"
    assert data["photo_retained"] is False
    assert data["items"][0]["food_code"] == "D301-022000000-0001"
    assert data["catalog_source"]["publisher"] == "식품의약품안전처"
    assert "nutrients" not in data["items"][0]


def test_unconfigured_provider_does_not_silently_mock():
    with TestClient(create_app(settings())) as client:
        assert client.get("/api/diet/status").json()["available"] is False
        assert post(client).status_code == 503


def test_bad_image_and_non_food_have_distinct_errors():
    provider = Provider({"is_food_photo": False, "foods": []})
    with TestClient(create_app(settings(), provider)) as client:
        assert post(client, image=b"not a png").status_code == 400
        result = post(client)
    assert result.status_code == 422
    assert result.json()["detail"]["code"] == "NOT_FOOD"
    assert provider.calls == 1


def test_invalid_model_output_fails_closed():
    with TestClient(
        create_app(
            settings(), Provider({"is_food_photo": True, "foods": [{"name": "   "}]})
        )
    ) as client:
        assert post(client).status_code == 502


def test_daily_limit_and_timeout_are_bounded():
    provider = Provider()
    with TestClient(create_app(settings(daily_limit=1), provider)) as client:
        assert post(client).status_code == 200
        assert post(client).status_code == 429
    assert provider.calls == 1

    class Slow(Provider):
        async def recognize(self, request):
            await asyncio.sleep(1)
            return ""

    with TestClient(create_app(settings(timeout=0.01), Slow())) as client:
        assert post(client).status_code == 504


def test_no_local_auth_bypass_in_production():
    config = settings()
    config.local = False
    with TestClient(create_app(config, Provider())) as client:
        assert post(client).status_code == 401


def test_normalization_strips_metadata_and_limits_dimensions():
    data = io.BytesIO()
    source = Image.new("RGB", (3000, 2200), "blue")
    exif = Image.Exif()
    exif[270] = "private metadata"
    source.save(data, format="JPEG", exif=exif)
    with Image.open(io.BytesIO(normalize_image(data.getvalue()))) as result:
        assert max(result.size) == 2048
        assert not result.getexif()


def test_fuzzy_match_never_assigns_another_foods_nutrients():
    catalog = Catalog()
    assert catalog.match("공기밥")[0]["food_code"] == "D301-022000000-0001"
    matched = catalog.match("김치찌개(돼지고기)")[0]
    assert matched is None or "돼지고기" in matched["name"]
    assert catalog.match("쌀바압")[0] is None
    assert catalog.match("쌀밥추가")[2]["food_code"] == "D301-022000000-0001"


def test_server_env_file_overrides_unrelated_host_key(tmp_path, monkeypatch):
    file = tmp_path / "private.env"
    file.write_text("VISION_API_KEY=\nVISION_MODEL=gpt-4o-mini\n", encoding="utf-8")
    monkeypatch.setenv("REXRUN_DIET_ENV_FILE", str(file))
    monkeypatch.setenv("OPENAI_API_KEY", "unrelated-host-value")
    monkeypatch.delenv("VISION_API_KEY", raising=False)
    assert Settings.environment().api_key == ""
    file.write_text(
        'VISION_API_KEY="unit-test-only"\nVISION_BASE_URL=https://unit.example/v1\n',
        encoding="utf-8",
    )
    config = Settings.environment()
    assert config.api_key == "unit-test-only"
    assert config.base_url == "https://unit.example/v1"


def test_credential_error_has_safe_actionable_message():
    from f6_diet.vision.base import VisionProviderError

    class InvalidCredentials(Provider):
        async def recognize(self, request):
            raise VisionProviderError("AuthenticationError")

    with TestClient(create_app(settings(), InvalidCredentials())) as client:
        result = post(client)
    assert result.status_code == 502
    assert result.json()["detail"]["code"] == "AI_CONFIGURATION"
    assert "AuthenticationError" not in result.text
