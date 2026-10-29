"""Stateless, consent-gated F6 preview API. Images are not persistently retained here."""

import asyncio
import hashlib
import io
import json
import os
import time
import uuid
import warnings
from contextlib import asynccontextmanager
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Annotated

import httpx
from dotenv import dotenv_values
from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from PIL import Image, ImageOps, UnidentifiedImageError
from pydantic import ValidationError

from .catalog import Catalog
from .quota import MemoryQuota, QuotaExceeded, QuotaUnavailable
from .recognition import recognize_meal
from .vision.base import (
    PromptTemplate,
    VisionProviderError,
    VisionRequest,
)
from .vision.openai_provider import OpenAIVisionProvider

ROOT = Path(__file__).resolve().parent.parent
MAX_UPLOAD = 10 * 1024 * 1024
MAX_PIXELS = 24_000_000


@dataclass
class Settings:
    local: bool
    api_key: str
    model: str
    base_url: str | None
    origins: list[str]
    supabase_url: str
    publishable_key: str
    timeout: float = 60
    daily_limit: int = 10

    @classmethod
    def environment(cls):
        env_file = Path(os.getenv("REXRUN_DIET_ENV_FILE") or ROOT / ".env")
        values = dotenv_values(env_file) if env_file.is_file() else {}

        def option(name: str, default=""):
            return os.getenv(name, values.get(name, default))

        # An explicitly blank VISION_API_KEY keeps this service unconfigured.
        api_key = (
            option("VISION_API_KEY")
            if "VISION_API_KEY" in values or "VISION_API_KEY" in os.environ
            else os.getenv("OPENAI_API_KEY", "")
        )
        config_path = ROOT.parents[1] / "frontend" / "cloud.config.json"
        config = json.loads(config_path.read_text()) if config_path.exists() else {}
        return cls(
            local=option("F6_APP_ENV") == "local",
            api_key=api_key or "",
            model=option("VISION_MODEL") or "gpt-4o",
            base_url=option("VISION_BASE_URL") or os.getenv("OPENAI_BASE_URL") or None,
            origins=[
                value.strip()
                for value in option(
                    "F6_ALLOWED_ORIGINS", "http://127.0.0.1:5173,http://localhost:5173"
                ).split(",")
                if value.strip()
            ],
            supabase_url=os.getenv("F6_SUPABASE_URL") or config.get("supabaseUrl", ""),
            publishable_key=os.getenv("F6_SUPABASE_PUBLISHABLE_KEY")
            or config.get("publishableKey", ""),
        )


def normalize_image(data: bytes) -> bytes:
    """Orient and strip EXIF, retaining enough resolution for bounded dish crops."""
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(io.BytesIO(data)) as source:
                if (
                    source.format not in {"JPEG", "PNG", "WEBP"}
                    or source.width * source.height > MAX_PIXELS
                ):
                    raise ValueError("unsupported image")
                image = ImageOps.exif_transpose(source).convert("RGB")
                image.thumbnail((2048, 2048), Image.Resampling.LANCZOS)
                output = io.BytesIO()
                image.save(output, format="JPEG", quality=85, optimize=True)
                return output.getvalue()
    except (
        UnidentifiedImageError,
        OSError,
        ValueError,
        Image.DecompressionBombError,
        Image.DecompressionBombWarning,
    ) as error:
        raise HTTPException(
            400,
            {"code": "INVALID_IMAGE", "message": "JPEG·PNG·WEBP 사진을 확인해 주세요."},
        ) from error


def create_app(settings: Settings | None = None, provider=None, quota=None):
    settings = settings or Settings.environment()
    catalog = Catalog()
    prompt_path = ROOT / "prompts" / "diet_vision_v3.md"
    prompt = PromptTemplate.load(prompt_path)
    prompt_hash = hashlib.sha256(prompt_path.read_bytes()).hexdigest()
    quota = quota or MemoryQuota()
    slots = asyncio.Semaphore(2)
    engine = provider or (
        OpenAIVisionProvider(settings.api_key, settings.model, settings.base_url)
        if settings.api_key
        else None
    )

    @asynccontextmanager
    async def lifespan(_):
        yield
        client = getattr(engine, "_client", None)
        if client:
            await client.close()

    app = FastAPI(title="REXRUN F6 diet preview", version="1.0.0", lifespan=lifespan)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.origins,
        allow_methods=["GET", "POST"],
        allow_headers=["Authorization", "Content-Type", "X-REXRUN-Development"],
        allow_credentials=False,
    )

    @app.middleware("http")
    async def guard(request: Request, call_next):
        if request.method == "POST":
            origin = request.headers.get("origin")
            if origin not in settings.origins:
                return JSONResponse(
                    {"code": "ORIGIN_DENIED", "message": "허용되지 않은 요청입니다."},
                    status_code=403,
                )
            length = request.headers.get("content-length", "")
            if not length.isdecimal():
                return JSONResponse(
                    {
                        "code": "LENGTH_REQUIRED",
                        "message": "사진 용량을 확인할 수 없어요.",
                    },
                    status_code=411,
                )
            if int(length) > MAX_UPLOAD + 65536:
                return JSONResponse(
                    {
                        "code": "IMAGE_TOO_LARGE",
                        "message": "사진은 10MB 이하로 선택해 주세요.",
                    },
                    status_code=413,
                )
        response = await call_next(request)
        response.headers["Cache-Control"] = "no-store"
        return response

    async def owner(request: Request) -> str:
        if settings.local:
            if request.headers.get(
                "x-rexrun-development"
            ) != "1" or request.client.host not in {"127.0.0.1", "::1", "testclient"}:
                raise HTTPException(
                    401,
                    {
                        "code": "UNAUTHORIZED",
                        "message": "로컬 개발 연결을 확인해 주세요.",
                    },
                )
            return "local-development"
        token = request.headers.get("authorization", "")
        if (
            not token.startswith("Bearer ")
            or not settings.supabase_url
            or not settings.publishable_key
        ):
            raise HTTPException(
                401, {"code": "UNAUTHORIZED", "message": "로그인이 필요해요."}
            )
        try:
            async with httpx.AsyncClient(timeout=10) as client:
                response = await client.get(
                    settings.supabase_url.rstrip("/") + "/auth/v1/user",
                    headers={
                        "Authorization": token,
                        "apikey": settings.publishable_key,
                    },
                )
            user_id = response.json().get("id") if response.status_code == 200 else None
            if not user_id:
                raise ValueError("Invalid session")
            return str(uuid.UUID(user_id))
        except (httpx.HTTPError, ValueError) as error:
            raise HTTPException(
                401, {"code": "UNAUTHORIZED", "message": "로그인을 다시 확인해 주세요."}
            ) from error

    @app.get("/api/diet/status")
    async def status():
        return {
            "available": engine is not None,
            "provider": "openai",
            "model": settings.model,
            "catalog_version": catalog.version,
            "catalog_kind": catalog.metadata["kind"],
            "catalog_source": catalog.metadata,
            "local": settings.local,
            "photo_retained": False,
        }

    @app.post("/api/diet/analyze")
    async def analyze(
        request: Request,
        photo: Annotated[UploadFile, File()],
        ai_consent: Annotated[bool, Form()] = False,
    ):
        user = await owner(request)
        if not ai_consent:
            await photo.close()
            raise HTTPException(
                400,
                {
                    "code": "CONSENT_REQUIRED",
                    "message": "외부 AI 사진 전송 동의를 확인해 주세요.",
                },
            )
        if engine is None:
            await photo.close()
            raise HTTPException(
                503,
                {
                    "code": "VISION_NOT_CONFIGURED",
                    "message": "사진 분석 서비스가 연결되지 않았어요. 직접 입력할 수 있어요.",
                },
            )
        try:
            data = await photo.read(MAX_UPLOAD + 1)
        finally:
            await photo.close()
        if len(data) > MAX_UPLOAD:
            raise HTTPException(
                413,
                {
                    "code": "IMAGE_TOO_LARGE",
                    "message": "사진은 10MB 이하로 선택해 주세요.",
                },
            )
        image = await asyncio.to_thread(normalize_image, data)
        date = datetime.now(timezone(timedelta(hours=9))).date().isoformat()
        try:
            await asyncio.to_thread(quota.consume, user, date, settings.daily_limit)
        except QuotaExceeded as error:
            raise HTTPException(
                429,
                {
                    "code": "RATE_LIMITED",
                    "message": "오늘 사진 분석 횟수를 모두 사용했어요.",
                },
            ) from error
        except QuotaUnavailable as error:
            raise HTTPException(
                503,
                {
                    "code": "QUOTA_UNAVAILABLE",
                    "message": "분석 연결을 확인해 주세요. 잠시 후 다시 시도해 주세요.",
                },
            ) from error
        # Bound request work and avoid retaining photo hashes or cross-user result caches.
        started = time.monotonic()
        try:
            async with asyncio.timeout(settings.timeout):
                async with slots:
                    result, passes, review_warnings, reviewed = await recognize_meal(
                        engine,
                        VisionRequest(
                            image=image,
                            mime_type="image/jpeg",
                            system_prompt=prompt.system,
                            user_prompt=prompt.render_user(
                                []  # Independent recognition; an arbitrary DB prefix would bias it toward rice dishes.
                            ),
                        ),
                        catalog,
                        deadline=started + settings.timeout - 1,
                        disconnected=request.is_disconnected,
                    )
        except TimeoutError as error:
            raise HTTPException(
                504,
                {
                    "code": "AI_TIMEOUT",
                    "message": "사진 분석이 지연됐어요. 다시 시도하거나 직접 입력해 주세요.",
                },
            ) from error
        except (ValidationError, ValueError) as error:
            raise HTTPException(
                502,
                {
                    "code": "AI_INVALID_OUTPUT",
                    "message": "분석 결과를 확인하지 못했어요. 직접 입력할 수 있어요.",
                },
            ) from error
        except VisionProviderError as error:
            raise HTTPException(
                502,
                {
                    "code": "AI_CONFIGURATION"
                    if str(error) in {"AuthenticationError", "PermissionDeniedError"}
                    else "AI_UNAVAILABLE",
                    "message": "분석 서버의 API 키·모델 접근 권한을 확인해 주세요. 직접 입력은 사용할 수 있어요."
                    if str(error) in {"AuthenticationError", "PermissionDeniedError"}
                    else "사진 분석 연결을 확인해 주세요. 직접 입력할 수 있어요.",
                },
            ) from error
        if not result.is_food_photo or not result.foods:
            raise HTTPException(
                422,
                {
                    "code": "NOT_FOOD",
                    "message": "음식을 확인하기 어려워요. 다른 사진이나 직접 입력을 이용해 주세요.",
                },
            )
        return {
            "analysis_id": str(uuid.uuid4()),
            "source": "vision",
            "provider": engine.name,
            "model": engine.model,
            "prompt_version": prompt.version,
            "prompt_sha256": prompt_hash,
            "catalog_version": catalog.version,
            "catalog_kind": catalog.metadata["kind"],
            "catalog_source": {
                key: catalog.metadata[key]
                for key in ("publisher", "source_url", "published_on")
            },
            "items": [
                {**catalog.item(food), "crop_reviewed": index in reviewed}
                for index, food in enumerate(result.foods)
            ],
            "analysis_passes": passes,
            "warnings": review_warnings,
            "latency_ms": round((time.monotonic() - started) * 1000),
            "photo_retained": False,
        }

    return app


app = create_app()
