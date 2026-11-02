import { z } from "zod";
import { cloudEnabled, supabase } from "../cloud/client";
import {
  foodByCode,
  loadOfficialFoods,
  catalogVersion,
  legacyCatalogVersion,
  type DietItem,
} from "../domain/diet";
import config from "../../diet.config.json";

const base =
  import.meta.env.VITE_REXRUN_DIET_API_URL || (import.meta.env.DEV ? "/api/diet" : config.apiUrl);
const itemSchema = z.object({
  name_input: z.string().trim().min(1).max(80),
  food_code: z.string().nullable(),
  name_final: z.string().trim().min(1).max(80),
  estimated_g: z.number().finite().min(5).max(1500).nullable(),
  portion_hint: z.string().max(100).nullable(),
  confidence: z.number().finite().min(0).max(1),
  is_soup: z.boolean(),
  suggested_food_code: z.string().nullable(),
  crop_reviewed: z.boolean().optional(),
  needs_confirmation: z.boolean().optional(),
});
const resultSchema = z.object({
  analysis_id: z.string().min(1).max(100),
  source: z.literal("vision"),
  model: z.string().max(120),
  catalog_version: z.enum([legacyCatalogVersion, catalogVersion]),
  warnings: z.array(z.string().max(200)).max(3).optional(),
  items: z.array(itemSchema).min(1).max(12),
  photo_retained: z.literal(false),
});
export async function dietStatus(signal: AbortSignal) {
  if (!base) return { available: false, provider: "openai", local: false };
  const response = await fetch(`${base}/status`, { signal, cache: "no-store" });
  if (!response.ok)
    throw new Error("식단 분석 서버에 연결하지 못했어요. 직접 입력은 사용할 수 있어요.");
  return z
    .object({ available: z.boolean(), provider: z.string(), local: z.boolean() })
    .parse(await response.json());
}
export const dietLoginRequired = import.meta.env.PROD && !cloudEnabled;

async function uploadImage(photo: string, signal: AbortSignal) {
  const blob = await (await fetch(photo, { signal })).blob();
  let image: ImageBitmap;
  try {
    image = await createImageBitmap(blob);
  } catch {
    signal.throwIfAborted();
    throw new Error("사진을 읽지 못했어요. 다른 JPEG·PNG·WEBP 사진을 선택해 주세요.");
  }
  try {
    signal.throwIfAborted();
    if (image.width * image.height > 24_000_000)
      throw new Error("사진 크기가 너무 커요. 2,400만 화소 이하 사진을 선택해 주세요.");
    const scale = Math.min(1, 2048 / Math.max(image.width, image.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.width * scale));
    canvas.height = Math.max(1, Math.round(image.height * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("사진을 준비하지 못했어요. 다시 선택해 주세요.");
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const result = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", 0.85),
    );
    signal.throwIfAborted();
    if (!result || result.size > 4 * 1024 * 1024)
      throw new Error("사진을 준비하지 못했어요. 더 작은 사진을 선택해 주세요.");
    return result;
  } finally {
    image.close();
  }
}

export async function analyzeDiet(
  photo: string,
  consent: boolean,
  signal: AbortSignal,
  owner: string,
) {
  if (!consent) throw new Error("사진의 외부 AI 전송 동의를 확인해 주세요.");
  if (!base) throw new Error("식단 분석 서버가 연결되지 않았어요.");
  if (dietLoginRequired)
    throw new Error(
      "사진 분석은 실제 계정으로 로그인한 뒤 사용할 수 있어요. 데모에서는 직접 입력할 수 있어요.",
    );
  if (!/^data:image\/(jpeg|png|webp);base64,/.test(photo) || photo.length > 14_100_000)
    throw new Error("10MB 이하 JPEG·PNG·WEBP 사진을 선택해 주세요.");
  const headers: Record<string, string> = {};
  if (cloudEnabled) {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session || session.user.id !== owner) throw new Error("로그인을 다시 확인해 주세요.");
    headers.Authorization = `Bearer ${session.access_token}`;
  }
  if (import.meta.env.DEV) headers["X-REXRUN-Development"] = "1";
  const blob = await uploadImage(photo, signal);
  const form = new FormData();
  form.append("photo", blob, "meal.jpg");
  form.append("ai_consent", "true");
  const response = await fetch(`${base}/analyze`, { method: "POST", headers, body: form, signal });
  const json = await response.json().catch(() => null);
  if (!response.ok)
    throw new Error(
      typeof json?.detail?.message === "string"
        ? json.detail.message
        : typeof json?.message === "string"
          ? json.message
          : "사진 분석을 완료하지 못했어요. 직접 입력할 수 있어요.",
    );
  const parsed = resultSchema.safeParse(json);
  if (!parsed.success)
    throw new Error("분석 결과 형식을 확인하지 못했어요. 직접 입력을 이용해 주세요.");
  const result = parsed.data;
  if (result.catalog_version !== legacyCatalogVersion) await loadOfficialFoods();
  return {
    id: result.analysis_id,
    model: result.model,
    catalogVersion: result.catalog_version,
    warnings: result.warnings ?? [],
    items: result.items.map(
      (item) =>
        ({
          id: crypto.randomUUID(),
          nameInput: item.name_input,
          name: item.name_final,
          foodCode: foodByCode(item.food_code) ? item.food_code : null,
          grams: item.estimated_g === null ? "" : String(item.estimated_g),
          estimatedGrams: item.estimated_g,
          confidence: item.confidence,
          portionHint: item.portion_hint,
          isSoup: item.is_soup,
          suggestedCode: item.suggested_food_code,
          cropReviewed: item.crop_reviewed,
          needsReview: item.needs_confirmation,
        }) satisfies DietItem,
    ),
  };
}
