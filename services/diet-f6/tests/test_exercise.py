import asyncio
import json
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest
from f6_diet.api import create_app
from f6_diet.exercise import ExerciseRequest, eligible, recommend
from fastapi.testclient import TestClient
from test_api import settings


def payload():
    date = datetime.now(timezone(timedelta(hours=9))).date().isoformat()
    return {
        "date": date,
        "ai_consent": True,
        "survey": {
            "motivation": "fun",
            "context": "ott",
            "minutes": 5,
            "activity": "inactive",
            "period": "evening",
            "limits": [],
            "clinicianCleared": True,
            "alcoholDays": 3,
            "binge": True,
            "updatedAt": 1,
        },
        "context": {
            "age": 34,
            "hypertension": True,
            "pressure": {"systolic": 148, "diastolic": 94},
            "pressureDate": date,
            "pregnancy": False,
            "recentCompleted": 1,
        },
    }


class Engine:
    model = "test-model"

    def __init__(self, items=None):
        self.calls = []
        self.items = items
        self._client = SimpleNamespace(
            chat=SimpleNamespace(completions=SimpleNamespace(create=self.create)),
            close=self.close,
        )

    async def close(self):
        pass

    async def create(self, **kwargs):
        self.calls.append(kwargs)
        data = {
            "summary": "재미있는 작은 성공부터 시작해요.",
            "items": self.items
            if self.items is not None
            else [{"id": "ott-walk", "reason": "드라마 시작 전에 5분만 움직여 봐요."}],
        }
        return SimpleNamespace(
            choices=[
                SimpleNamespace(
                    finish_reason="stop",
                    message=SimpleNamespace(refusal=None, content=json.dumps(data)),
                )
            ]
        )


def test_only_bounded_candidates_and_no_exact_bp_name_sent_to_model():
    engine = Engine()
    result = asyncio.run(recommend(ExerciseRequest(**payload()), engine))
    assert result["source"] == "ai" and result["model"] == "test-model"
    forwarded = json.loads(engine.calls[0]["messages"][1]["content"])
    assert (
        "context" not in forwarded
        and "pressure" not in forwarded
        and "age" not in forwarded
    )
    assert "systolic" not in json.dumps(forwarded) and "이시연" not in json.dumps(
        forwarded
    )
    assert forwarded["preferences"]["context"] == "ott"
    assert "long-walk" not in {e["id"] for e in forwarded["candidates"]}


@pytest.mark.parametrize(
    "pressure",
    [{"systolic": 180, "diastolic": 90}, {"systolic": 150, "diastolic": 120}],
)
def test_high_reading_does_not_call_llm(pressure):
    data = payload()
    data["context"]["pressure"] = pressure
    engine = Engine()
    result = asyncio.run(recommend(ExerciseRequest(**data), engine))
    assert result["items"] == [] and engine.calls == []


def test_unknown_bp_and_restrictions_limit_candidates():
    data = payload()
    data["context"]["pressure"] = None
    data["context"]["pressureDate"] = None
    assert all(e["kind"] == "stretch" for e in eligible(ExerciseRequest(**data)))
    data["survey"]["clinicianCleared"] = False
    assert eligible(ExerciseRequest(**data)) == []


@pytest.mark.parametrize(
    "items",
    [
        [{"id": "unsafe-burpees", "reason": "운동"}],
        [{"id": "ott-walk", "reason": "운동"}, {"id": "ott-walk", "reason": "운동"}],
        [],
    ],
)
def test_invalid_or_duplicate_output_rejected(items):
    with pytest.raises(ValueError):
        asyncio.run(recommend(ExerciseRequest(**payload()), Engine(items)))


def test_api_requires_consent_and_local_auth_and_enforces_daily_quota():
    engine = Engine()
    headers = {"Origin": "http://127.0.0.1:5173", "X-REXRUN-Development": "1"}
    with TestClient(create_app(settings(), engine)) as client:
        data = payload()
        data["ai_consent"] = False
        assert (
            client.post(
                "/api/diet/exercise/recommend", json=data, headers=headers
            ).status_code
            == 400
        )
        data["ai_consent"] = True
        assert (
            client.post(
                "/api/diet/exercise/recommend",
                json=data,
                headers={"Origin": headers["Origin"]},
            ).status_code
            == 401
        )
        for _ in range(5):
            assert (
                client.post(
                    "/api/diet/exercise/recommend", json=data, headers=headers
                ).status_code
                == 200
            )
        assert (
            client.post(
                "/api/diet/exercise/recommend", json=data, headers=headers
            ).status_code
            == 429
        )
    assert len(engine.calls) == 5
