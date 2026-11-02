import { test, expect } from "@playwright/test";
import { selectPixelOption } from "./helpers/controls";
test("video demo has 90 days, model replay and period-consistent dashboard views", async ({
  page,
}) => {
  await page.goto("/demo/studio-quarter");
  await expect(page).toHaveURL(/dashboard\?period=quarter/);
  const summary = page.getByRole("region", { name: "최종 분석 요약" });
  await expect(summary).toContainText("수면 관련 확인 1항목");
  await expect(summary).toContainText("합성 입력 · 모델 결과 재생");
  await expect(page.getByRole("region", { name: "선택 기간 핵심 지표" })).toContainText("90일");
  const counts = await page.evaluate(async () => {
    const p = "/src/stores/game-store.ts",
      d = "/src/stores/diet-store.ts";
    const [{ useGameStore }, { useDietStore }] = await Promise.all([import(p), import(d)]);
    return {
      surveys: Object.keys(useGameStore.getState().game.dailySurveys).length,
      meals: useDietStore.getState().records.length,
    };
  });
  expect(counts).toEqual({ surveys: 90, meals: 180 });
  await expect(page.getByRole("region", { name: "식단 영양 구성" })).toContainText("180끼 기록");
  const firstDate = await page.locator(".habit-grid button").first().getAttribute("title");
  await page.locator(".habit-grid button").first().click();
  await selectPixelOption(page.getByRole("combobox", { name: "건강 변화 조회 기간" }), "week");
  await expect(page.getByRole("region", { name: "선택 기간 핵심 지표" })).toContainText("7일");
  await expect(page.getByRole("region", { name: "식단 영양 구성" })).toContainText("14끼 기록");
  await expect(page.locator(".habit-day")).not.toContainText(firstDate!);
  await expect(summary).toContainText("수면 관련 확인 1항목");
});
test("demo layouts stay contained and history cells reveal their exact record", async ({
  page,
}) => {
  await page.goto("/demo/studio-quarter");
  await expect(page.getByRole("region", { name: "최종 분석 요약" })).toContainText(
    "수면 관련 확인",
  );
  for (const width of [320, 390, 430, 1000]) {
    await page.setViewportSize({ width, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  }
  await page.setViewportSize({ width: 390, height: 844 });
  const cells = page.locator(".habit-grid button");
  expect(await cells.count()).toBe(90);
  await cells.first().click();
  await expect(page.locator(".habit-day")).toContainText(
    (await cells.first().getAttribute("title")) ?? "",
  );
  if (process.env.REXRUN_CAPTURE_QUARTER) {
    await page.locator(".main-content").evaluate((e) => (e.scrollTop = 0));
    await page.screenshot({ path: process.env.REXRUN_CAPTURE_QUARTER + "/top.png" });
    await page.getByRole("region", { name: "수면 리듬" }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: process.env.REXRUN_CAPTURE_QUARTER + "/sleep-nutrition.png" });
  }
});
test("editing a demo survey clears the recorded model result and reset preserves other accounts", async ({
  page,
}) => {
  await page.goto("/demo/studio-quarter");
  await expect(page.getByRole("region", { name: "최종 분석 요약" })).toContainText(
    "수면 관련 확인",
  );
  await page.evaluate(async () => {
    localStorage.setItem("rexrun-persona:office-month:sentinel", "keep");
    localStorage.setItem("account-isolation-sentinel", "keep");
    const path = "/src/stores/game-store.ts",
      { useGameStore } = await import(path);
    const game = useGameStore.getState().game;
    useGameStore.setState({
      game: {
        ...game,
        dailySurveys: {
          ...game.dailySurveys,
          [game.date]: { ...game.dailySurveys[game.date], activeMinutes: 1 },
        },
      },
    });
  });
  await expect(page.getByRole("region", { name: "최종 분석 요약" })).toContainText(
    "입력 변경됨 · 시연 초기화로 복원",
    { timeout: 10000 },
  );
  await page.getByRole("button", { name: "시연 초기화", exact: true }).click();
  await expect(page.getByRole("region", { name: "최종 분석 요약" })).toContainText(
    "수면 관련 확인",
  );
  expect(
    await page.evaluate(() => [
      localStorage.getItem("rexrun-persona:office-month:sentinel"),
      localStorage.getItem("account-isolation-sentinel"),
    ]),
  ).toEqual(["keep", "keep"]);
});
