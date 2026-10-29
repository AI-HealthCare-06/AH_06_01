"""Explicit opt-in developer benchmark; never prints credentials, prompts or image bytes."""

import argparse
import asyncio
import hashlib
import json
import time
from pathlib import Path


async def benchmark(args):
    from f6_diet.api import Settings, normalize_image
    from f6_diet.catalog import Catalog
    from f6_diet.recognition import recognize_meal
    from f6_diet.vision.base import PromptTemplate, VisionRequest
    from f6_diet.vision.openai_provider import OpenAIVisionProvider

    settings = Settings.environment()
    if not settings.api_key:
        raise SystemExit("Server vision key is not configured")
    original = args.image.read_bytes()
    image = normalize_image(original)
    prompt = PromptTemplate.load(
        Path(__file__).resolve().parents[1] / "prompts/diet_vision_v3.md"
    )
    catalog = Catalog()
    rows = []
    for model in args.models.split(","):
        provider = OpenAIVisionProvider(
            settings.api_key, model.strip(), settings.base_url
        )
        started = time.perf_counter()
        try:
            result, passes, warnings, _ = await recognize_meal(
                provider,
                VisionRequest(
                    image, "image/jpeg", prompt.system, prompt.render_user([])
                ),
                catalog,
                max_reviews=1,
                deadline=time.monotonic() + 55,
            )
            rows.append(
                {
                    "model": model,
                    "status": "ok",
                    "latencyMs": round((time.perf_counter() - started) * 1000),
                    "calls": len(passes),
                    "foods": [
                        {
                            "name": f.name,
                            "estimatedGrams": f.estimated_g,
                            "matchedFoodCode": (catalog.match(f.name)[0] or {}).get(
                                "food_code"
                            ),
                        }
                        for f in result.foods
                    ],
                    "warnings": warnings,
                }
            )
        except Exception as error:
            cause = error.__cause__
            rows.append(
                {
                    "model": model,
                    "status": "error",
                    "errorType": str(error)
                    if type(error).__name__ == "VisionProviderError"
                    else type(error).__name__,
                    "httpStatus": getattr(cause, "status_code", None),
                    "code": getattr(cause, "code", None),
                    "parameter": getattr(cause, "param", None),
                    "latencyMs": round((time.perf_counter() - started) * 1000),
                }
            )
        finally:
            await provider._client.close()
    report = {
        "developmentOnly": True,
        "sampleCount": 1,
        "imageSha256": hashlib.sha256(original).hexdigest(),
        "catalogVersion": catalog.version,
        "promptVersion": prompt.version,
        "comparisonScope": "Models under identical v3 structured vision protocol; not a population accuracy test or a legacy protocol comparison",
        "portionGroundTruth": None,
        "results": rows,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(
        json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    print(json.dumps({"report": str(args.output), "results": rows}, ensure_ascii=False))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("image", type=Path)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--models", default="gpt-4o-mini,gpt-4o")
    parser.add_argument(
        "--run-api",
        action="store_true",
        help="Transmit this developer image and incur at most two calls per model",
    )
    args = parser.parse_args()
    if not args.run_api:
        parser.error("Add --run-api to explicitly authorize this developer benchmark")
    if len(args.models.split(",")) > 2:
        parser.error("At most two models in one run")
    asyncio.run(benchmark(args))


if __name__ == "__main__":
    main()
