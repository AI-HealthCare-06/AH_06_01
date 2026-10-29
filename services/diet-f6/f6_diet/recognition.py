"""Bounded overview -> uncertain food crop review. Nothing is persisted or cached."""

import asyncio
import io
import time
from PIL import Image
from .schemas import VisionResult
from .vision.base import VisionRequest, strip_code_fence


def crop_food(image: bytes, bbox: list[float]) -> bytes | None:
    with Image.open(io.BytesIO(image)) as source:
        left, top, right, bottom = bbox
        if (
            right - left < 0.03
            or bottom - top < 0.03
            or (right - left) * (bottom - top) > 0.85
        ):
            return None
        cropped = source.crop(
            (
                round(left * source.width),
                round(top * source.height),
                round(right * source.width),
                round(bottom * source.height),
            )
        )
        if min(cropped.size) < 24:
            return None
        cropped.thumbnail((1024, 1024), Image.Resampling.LANCZOS)
        output = io.BytesIO()
        cropped.save(output, format="JPEG", quality=92)
        return output.getvalue()


async def recognize_meal(
    engine,
    request: VisionRequest,
    catalog,
    max_reviews=2,
    deadline=None,
    disconnected=None,
):
    raw = await engine.recognize(request)
    if len(raw) > 65536:
        raise ValueError("Oversized model output")
    result = VisionResult.model_validate_json(strip_code_fence(raw))
    passes = [{"kind": "overview", "model": engine.model}]
    warnings = []
    reviewed = set()
    if not result.is_food_photo:
        return result, passes, warnings, reviewed
    candidates = sorted(enumerate(result.foods), key=lambda pair: pair[1].confidence)
    for index, food in candidates:
        if len(passes) > max_reviews:
            break
        if food.bbox is None or (
            food.confidence >= 0.8 and catalog.match(food.name)[0]
        ):
            continue
        if disconnected is not None and await disconnected():
            break
        remaining = min(12, deadline - time.monotonic()) if deadline else 12
        if remaining < 2:
            warnings.append(
                "확대 확인 시간 한도에 도달했어요. 음식 이름을 직접 확인해 주세요."
            )
            break
        crop = await asyncio.to_thread(crop_food, request.image, food.bbox)
        if crop is None:
            continue
        passes.append({"kind": "crop", "model": engine.model, "item_index": index})
        try:
            async with asyncio.timeout(remaining):
                text = await engine.recognize(
                    VisionRequest(
                        crop,
                        "image/jpeg",
                        request.system_prompt,
                        f"확대된 한 음식의 이름을 재확인해 줘. 초기 이름은 {food.name!r}이지만 오인식일 수 있다. 중량은 다시 추정하지 마.",
                        max_output_tokens=900,
                    )
                )
            if len(text) > 65536:
                raise ValueError("Oversized model output")
            review = VisionResult.model_validate_json(strip_code_fence(text))
            if not review.is_food_photo or len(review.foods) != 1:
                raise ValueError("Ambiguous review")
            revised = review.foods[0]
            # A cropped view cannot improve the physical portion measurement.
            result.foods[index] = food.model_copy(
                update={
                    "name": revised.name,
                    "confidence": min(food.confidence, revised.confidence)
                    if revised.name != food.name
                    else revised.confidence,
                    "is_soup": revised.is_soup,
                    "in_candidates": revised.in_candidates,
                }
            )
            reviewed.add(index)
        except asyncio.CancelledError:
            raise
        except Exception:
            warnings.append(
                f"음식 {index + 1}의 확대 확인을 완료하지 못했어요. 이름을 직접 확인해 주세요."
            )
    return result, passes, warnings, reviewed
