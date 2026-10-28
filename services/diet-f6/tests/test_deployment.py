import base64
import json
from types import SimpleNamespace

import httpx
import pytest
from botocore.exceptions import ClientError
from f6_diet.api import create_app
from f6_diet.quota import DynamoQuota, QuotaExceeded, QuotaUnavailable
from fastapi.testclient import TestClient
from mangum import Mangum
from test_api import Provider, photo, post, settings


def test_remote_auth_uses_supabase_and_quota_before_vision(monkeypatch):
    user = "10000000-0000-4000-8000-000000000001"
    config = settings()
    config.local = False
    config.supabase_url = "https://auth.example"
    config.publishable_key = "test-publishable"
    calls = []

    async def get_session(self, url, headers):
        calls.append((url, headers["Authorization"]))
        return httpx.Response(200, json={"id": user})

    monkeypatch.setattr(httpx.AsyncClient, "get", get_session)

    class Quota:
        def consume(self, owner, date, limit):
            assert owner == user and limit == 10
            raise QuotaUnavailable()

    provider = Provider()
    with TestClient(create_app(config, provider, Quota())) as client:
        response = post(
            client,
            headers={"Origin": config.origins[0], "Authorization": "Bearer test"},
        )
    assert calls == [("https://auth.example/auth/v1/user", "Bearer test")]
    assert response.status_code == 503
    assert provider.calls == 0


def test_persistent_quota_is_atomic_and_fails_closed():
    class Conditional(Exception):
        pass

    class Table:
        def __init__(self):
            self.writes = []
            self.error = None
            self.meta = SimpleNamespace(
                client=SimpleNamespace(
                    exceptions=SimpleNamespace(
                        ConditionalCheckFailedException=Conditional
                    )
                )
            )

        def update_item(self, **kw):
            if self.error:
                raise self.error
            self.writes.append(kw)

    table = Table()
    quota = DynamoQuota(table)
    quota.consume("private-user-id", "2026-10-27", 10)
    assert len(table.writes) == 2
    assert "private-user-id" not in str(table.writes)
    assert all("ConditionExpression" in write for write in table.writes)
    table.error = Conditional()
    with pytest.raises(QuotaExceeded):
        quota.consume("user", "2026-10-27", 10)
    table.error = ClientError(
        {"Error": {"Code": "AccessDeniedException"}}, "UpdateItem"
    )
    with pytest.raises(QuotaUnavailable):
        quota.consume("user", "2026-10-27", 10)


def test_function_url_binary_multipart_and_cors():
    config = settings()
    config.local = False
    config.origins = ["https://localhost"]
    provider = Provider()
    adapter = Mangum(create_app(config, provider), lifespan="off")
    boundary = "TestBoundary"
    body = (
        (
            f'--{boundary}\r\nContent-Disposition: form-data; name="ai_consent"\r\n\r\ntrue\r\n'
            f'--{boundary}\r\nContent-Disposition: form-data; name="photo"; filename="rice.png"\r\n'
            "Content-Type: image/png\r\n\r\n"
        ).encode()
        + photo()
        + f"\r\n--{boundary}--\r\n".encode()
    )
    event = {
        "version": "2.0",
        "routeKey": "$default",
        "rawPath": "/api/diet/analyze",
        "rawQueryString": "",
        "isBase64Encoded": True,
        "headers": {
            "origin": "https://localhost",
            "content-type": f"multipart/form-data; boundary={boundary}",
            "content-length": str(len(body)),
            "x-rexrun-development": "1",
        },
        "requestContext": {
            "http": {
                "method": "POST",
                "sourceIp": "192.0.2.1",
                "path": "/api/diet/analyze",
                "protocol": "HTTP/1.1",
            }
        },
        "body": base64.b64encode(body).decode(),
    }
    result = adapter(event, {})
    assert result["statusCode"] == 401
    assert result["headers"]["access-control-allow-origin"] == "https://localhost"
    assert json.loads(result["body"])["detail"]["code"] == "UNAUTHORIZED"
    assert provider.calls == 0
