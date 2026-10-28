import { selectPixelOption } from "./helpers/controls";
import { expect, test } from "@playwright/test";
const image = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAABQAAAAUCAIAAAAC64paAAAAK0lEQVR4nGNkaGAgGzCRr5VhVDOpgIlkHUhgVDOJgIlUDchgVDOJgKIAAwDFMgCoOrIAcgAAAABJRU5ErkJggg==",
  "base64",
);
const result = {
  analysis_id: "mock-analysis-001",
  source: "vision",
  model: "test-double-not-real-vision",
  catalog_version: "f6-dev-sample-v1",
  photo_retained: false,
  items: [
    {
      name_input: "공기밥",
      name_final: "쌀밥",
      food_code: "DEV-0001",
      estimated_g: 210,
      portion_hint: "밥 1공기",
      confidence: 0.9,
      is_soup: false,
      suggested_food_code: null,
    },
    {
      name_input: "모둠초밥",
      name_final: "모둠초밥",
      food_code: null,
      estimated_g: 300,
      portion_hint: "1접시",
      confidence: 0.6,
      is_soup: false,
      suggested_food_code: null,
    },
  ],
};
async function mock(page: import("@playwright/test").Page, error = false) {
  let calls = 0;
  await page.route("**/api/diet/**", async (route) => {
    if (route.request().url().endsWith("/status"))
      return route.fulfill({ json: { available: true, provider: "openai", local: true } });
    calls++;
    return route.fulfill({
      status: error ? 502 : 200,
      json: error
        ? { detail: { code: "AI_CONFIGURATION", message: "분석 서버의 API 키를 확인해 주세요." } }
        : result,
    });
  });
  return () => calls;
}

test("photo analysis is opt-in, editable, partial and saved without photo or game proof", async ({
  page,
}) => {
  const calls = await mock(page);
  await page.goto("/meals");
  await page
    .getByLabel("분석할 식사 사진", { exact: true })
    .setInputFiles({ name: "generated-test.png", mimeType: "image/png", buffer: image });
  const analyze = page.getByRole("button", { name: "사진으로 분석", exact: true });
  await expect(analyze).toBeDisabled();
  expect(calls()).toBe(0);
  await page.getByRole("checkbox", { name: /이 사진을 분석 서버와 OpenAI/ }).check();
  await analyze.click();
  await expect(page.getByLabel("음식 1 중량", { exact: true })).toHaveValue("210");
  await expect(page.locator(".diet-missing")).toContainText(["영양값이 없습니다."]);
  await page.getByLabel("음식 1 중량", { exact: true }).fill("150");
  await expect(page.locator(".diet-main-nutrients").first()).toContainText("210");
  await expect(page.locator(".diet-macros")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "확인한 식단 기록 저장", exact: true }),
  ).toBeDisabled();
  await page
    .getByRole("checkbox", { name: "음식 이름과 실제 먹은 양을 확인했습니다.", exact: true })
    .check();
  await page.getByRole("button", { name: "확인한 식단 기록 저장", exact: true }).click();
  await expect(page.getByRole("button", { name: "식단 저장 완료", exact: true })).toBeDisabled();
  await expect(page.getByRole("region", { name: "저장한 식단 기록", exact: true })).toContainText(
    "쌀밥 150g",
  );
  const state = await page.evaluate(async () => {
    const path = "/src/stores/quest-verification-store.ts";
    const { useQuestVerificationStore } = await import(path);
    return {
      proofs: useQuestVerificationStore.getState().proofs,
      diet: Object.keys(localStorage)
        .filter((key) => key.includes("diet-records"))
        .map((key) => localStorage.getItem(key)),
    };
  });
  expect(state.proofs.meal).toBeUndefined();
  expect(JSON.stringify(state.diet)).not.toContain("data:image");
  expect(calls()).toBe(1);
  await page.reload();
  await expect(page.getByRole("region", { name: "저장한 식단 기록", exact: true })).toContainText(
    "모둠초밥 300g",
  );
  expect(calls()).toBe(1);
});

test("samples never save; manual nutrition and deletion work without AI", async ({ page }) => {
  const calls = await mock(page);
  await page.goto("/meals");
  await page.getByRole("button", { name: "결과 예시 보기", exact: true }).click();
  await expect(page.locator(".diet-result-source")).toContainText("현재 사진 분석 아님");
  await expect(
    page.getByRole("button", { name: "확인한 식단 기록 저장", exact: true }),
  ).toHaveCount(0);
  expect(calls()).toBe(0);
  await page.getByRole("button", { name: "직접 입력", exact: true }).click();
  await selectPixelOption(page.getByLabel("음식 1 영양 DB", { exact: true }), "DEV-0001");
  await page.getByLabel("음식 1 중량", { exact: true }).fill("150");
  await page
    .getByRole("checkbox", { name: "음식 이름과 실제 먹은 양을 확인했습니다.", exact: true })
    .check();
  await page.getByRole("button", { name: "확인한 식단 기록 저장", exact: true }).click();
  await expect(page.locator(".meal-history li")).toHaveCount(1);
  await page.getByRole("button", { name: "이 식단 기록 삭제", exact: true }).click();
  await expect(page.locator(".meal-history li")).toHaveCount(0);
  expect(calls()).toBe(0);
});

test("API errors are shown without replacing them with an invented meal", async ({ page }) => {
  await mock(page, true);
  await page.goto("/meals");
  await page
    .getByLabel("분석할 식사 사진", { exact: true })
    .setInputFiles({ name: "generated-test.png", mimeType: "image/png", buffer: image });
  await page.getByRole("checkbox", { name: /이 사진을 분석 서버와 OpenAI/ }).check();
  await page.getByRole("button", { name: "사진으로 분석", exact: true }).click();
  await expect(page.locator(".diet-status")).toContainText("API 키");
  await expect(page.locator(".diet-item")).toHaveCount(0);
  await expect(page.locator(".meal-history li")).toHaveCount(0);
});

test("replacing a photo discards late analysis responses", async ({ page }) => {
  let finish: () => void = () => {};
  let entered = false;
  await page.route("**/api/diet/**", async (route) => {
    if (route.request().url().endsWith("/status"))
      return route.fulfill({ json: { available: true, provider: "openai", local: true } });
    entered = true;
    await new Promise<void>((resolve) => (finish = resolve));
    await route.fulfill({ json: result }).catch(() => {});
  });
  await page.goto("/meals");
  const input = page.getByLabel("분석할 식사 사진", { exact: true });
  await input.setInputFiles({ name: "first.png", mimeType: "image/png", buffer: image });
  await page.getByRole("checkbox", { name: /이 사진을 분석 서버와 OpenAI/ }).check();
  await page.getByRole("button", { name: "사진으로 분석", exact: true }).click();
  await expect.poll(() => entered).toBe(true);
  await input.setInputFiles({ name: "first.png", mimeType: "image/png", buffer: image });
  finish();
  await expect(
    page.getByRole("checkbox", { name: /이 사진을 분석 서버와 OpenAI/ }),
  ).not.toBeChecked();
  await expect(page.locator(".diet-item")).toHaveCount(0);
});

test("meal camera keeps photo proof separate from opt-in AI", async ({ page }) => {
  const calls = await mock(page);
  await page.addInitScript(() => {
    Object.defineProperty(navigator.mediaDevices, "getUserMedia", {
      value: async () => {
        const canvas = document.createElement("canvas");
        canvas.width = 480;
        canvas.height = 640;
        const context = canvas.getContext("2d")!;
        context.fillStyle = "#e8deb2";
        context.fillRect(0, 0, 480, 640);
        return canvas.captureStream(10);
      },
    });
  });
  await page.goto("/camera?quest=meal");
  await page.getByRole("button", { name: "카메라 켜기", exact: true }).click();
  await page.getByRole("button", { name: "촬영하기", exact: true }).click();
  await expect(page.getByRole("region", { name: "식단 사진 분석", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "이 사진 사용", exact: true }).click();
  await expect(
    page.getByRole("link", { name: "인증한 퀘스트 완료하기", exact: true }),
  ).toBeVisible();
  expect(calls()).toBe(0);
});

test("meal editor and daily summary fit phone widths and are reachable from quests", async ({
  page,
}) => {
  await mock(page);
  await page.goto("/quests");
  await page.getByRole("link", { name: "식단 분석·기록 보기 ›", exact: true }).click();
  await expect(page).toHaveURL(/\/meals$/);
  await page.getByRole("button", { name: "결과 예시 보기", exact: true }).click();
  for (const width of [320, 390, 430]) {
    await page.setViewportSize({ width, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  }
});

test("a failed reanalysis never leaves a previous successful meal on screen", async ({ page }) => {
  let attempts = 0;
  await page.route("**/api/diet/**", async (route) => {
    if (route.request().url().endsWith("/status"))
      return route.fulfill({ json: { available: true, provider: "openai", local: true } });
    attempts++;
    return route.fulfill({
      status: attempts === 1 ? 200 : 502,
      json:
        attempts === 1
          ? result
          : { detail: { code: "AI_CONFIGURATION", message: "API 키를 확인해 주세요." } },
    });
  });
  await page.goto("/meals");
  await page
    .getByLabel("분석할 식사 사진", { exact: true })
    .setInputFiles({ name: "generated-test.png", mimeType: "image/png", buffer: image });
  await page.getByRole("checkbox", { name: /이 사진을 분석 서버와 OpenAI/ }).check();
  await page.getByRole("button", { name: "사진으로 분석", exact: true }).click();
  await expect(page.locator(".diet-item")).toHaveCount(2);
  await page.getByRole("button", { name: "사진으로 분석", exact: true }).click();
  await expect(page.locator(".diet-status")).toContainText("API 키");
  await expect(page.locator(".diet-item")).toHaveCount(0);
});

test("corrupt images show a readable error before any upload", async ({ page }) => {
  const calls = await mock(page);
  await page.goto("/meals");
  await page.getByLabel("분석할 식사 사진", { exact: true }).setInputFiles({
    name: "broken.png",
    mimeType: "image/png",
    buffer: Buffer.from("invalid-image"),
  });
  await page.getByRole("checkbox", { name: /이 사진을 분석 서버와 OpenAI/ }).check();
  await page.getByRole("button", { name: "사진으로 분석", exact: true }).click();
  await expect(page.locator(".diet-status")).toContainText("사진을 읽지 못했어요");
  expect(calls()).toBe(0);
});

test("phone photos are resized to JPEG before uploading", async ({ page }) => {
  await mock(page);
  await page.goto("/meals");
  const image = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 2048;
    canvas.height = 1536;
    canvas.getContext("2d")!.fillRect(0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/png").split(",")[1];
  });
  let uploaded: Buffer | null = null;
  page.on("request", (request) => {
    if (request.url().endsWith("/api/diet/analyze")) uploaded = request.postDataBuffer();
  });
  await page.getByLabel("분석할 식사 사진", { exact: true }).setInputFiles({
    name: "phone.png",
    mimeType: "image/png",
    buffer: Buffer.from(image, "base64"),
  });
  await page.getByRole("checkbox", { name: /이 사진을 분석 서버와 OpenAI/ }).check();
  await page.getByRole("button", { name: "사진으로 분석", exact: true }).click();
  await expect(page.getByLabel("음식 1 중량", { exact: true })).toHaveValue("210");
  const body = uploaded! as Buffer;
  expect(body.length).toBeLessThan(4 * 1024 * 1024);
  const jpeg = body.subarray(
    body.indexOf(Buffer.from([255, 216])),
    body.lastIndexOf(Buffer.from([255, 217])) + 2,
  );
  const size = await page.evaluate(async (b64) => {
    const blob = await (await fetch("data:image/jpeg;base64," + b64)).blob();
    const bitmap = await createImageBitmap(blob);
    const result = [bitmap.width, bitmap.height];
    bitmap.close();
    return result;
  }, jpeg.toString("base64"));
  expect(size).toEqual([1024, 768]);
});
