import { test, expect, type Page } from "@playwright/test";
import { selectPixelOption } from "./helpers/controls";
import { expectNoHorizontalOverflow } from "./helpers/layout";

const summary = (page: Page) => page.getByRole("region", { name: "최종 분석 요약" });

test("quarter demo uses real daily averages and raw latest readings even when model API is unavailable", async ({
  page,
}) => {
  await page.route("**/predictions/**", (route) => route.abort());
  await page.goto("/demo/studio-quarter");
  const brief = summary(page);
  await expect(brief).toHaveAttribute("data-bp-mode", "measured");
  await expect(brief).toContainText("134 / 87 mmHg");
  await expect(brief).toContainText("기록 90일 · 측정 180회");
  await brief.locator("summary").click();
  const expected = await page.evaluate(async () => {
    const p = "/src/stores/game-store.ts";
    const { useGameStore } = await import(p);
    const rows = Object.values(useGameStore.getState().game.dailySurveys) as Array<{
      morning: { systolic: number; diastolic: number };
      evening: { systolic: number; diastolic: number };
    }>;
    return ["systolic", "diastolic"]
      .map((key) =>
        (
          rows.reduce(
            (s, r) => s + (r.morning[key as "systolic"] + r.evening[key as "systolic"]) / 2,
            0,
          ) / rows.length
        ).toFixed(1),
      )
      .join(" / ");
  });
  await expect(brief.locator(".measured-vitals")).toContainText(expected);
  await expect(brief).toContainText("초반 7개 기록일 → 최근 7개 기록일");
  await expect(brief).not.toContainText("정상 참고권");
  for (const [period, count] of [
    ["week", "기록 7일 · 측정 14회"],
    ["day", "기록 1일 · 측정 2회"],
  ]) {
    await selectPixelOption(page.getByRole("combobox", { name: "건강 변화 조회 기간" }), period);
    await expect(brief).toContainText(count);
  }
  await expect(brief.locator(".measured-vitals")).toContainText("135.0 / 87.5");
  await expect(brief).toContainText("같은 날 아침 → 저녁");
  await expect(brief.locator(".measured-trend")).toContainText("수축기 ↓ 2.0 · 이완기 ↓ 1.0 mmHg");
  await expect(page.getByRole("region", { name: "저장된 건강 기록 추이" })).toContainText(
    "135.0 / 87.5",
  );
});

test("clearing measured data switches to lifestyle measurement advice without a false normal result", async ({
  page,
}) => {
  await page.goto("/demo/studio-quarter");
  await expect(summary(page)).toHaveAttribute("data-bp-mode", "measured");
  await page.evaluate(async () => {
    const g = "/src/stores/game-store.ts",
      p = "/src/stores/profile-store.ts";
    const [{ useGameStore }, { useProfileStore }] = await Promise.all([import(g), import(p)]);
    const game = useGameStore.getState().game;
    useGameStore.setState({
      game: {
        ...game,
        healthHistory: Object.fromEntries(
          Object.entries(game.healthHistory).map(([date, r]) => [
            date,
            { ...(r as object), systolic: null, diastolic: null },
          ]),
        ),
        dailySurveys: Object.fromEntries(
          Object.entries(game.dailySurveys).map(([date, r]) => [
            date,
            { ...(r as object), bloodPressureStatus: "not-measured", morning: null, evening: null },
          ]),
        ),
      },
    });
    useProfileStore.setState({
      profile: { ...useProfileStore.getState().profile, bloodPressure: null },
      hasBloodPressureInput: false,
    });
  });
  const brief = summary(page);
  await expect(brief).toHaveAttribute("data-bp-mode", "lifestyle");
  await expect(brief).toContainText("혈압을 측정해 기록해 주세요");
  await expect(brief).not.toContainText("134 / 87");
  await expect(brief).not.toContainText("정상 참고권");
  await brief.locator("summary").click();
  await expect(brief).toContainText("혈압 기록 없음은 정상 판정이 아니에요.");
  await expect(brief).toContainText("수면");
  if (process.env.REXRUN_CAPTURE_PRESSURE) {
    await page.screenshot({ path: process.env.REXRUN_CAPTURE_PRESSURE + "/lifestyle.png" });
  }
  await brief.getByRole("link", { name: "혈압 기록하기" }).click();
  await expect(page).toHaveURL(/daily-survey/);
  await expect(page.getByRole("dialog")).toBeVisible();
});

test("empty historical periods do not borrow future demo readings or current model results", async ({
  page,
}) => {
  await page.goto("/demo/studio-quarter");
  await expect(summary(page)).toHaveAttribute("data-bp-mode", "measured");
  const before = await page.evaluate(async () => {
    const p = "/src/stores/game-store.ts";
    const { useGameStore } = await import(p);
    const game = useGameStore.getState().game;
    const first = Object.keys(game.dailySurveys).sort()[0];
    const day = new Date(first + "T12:00:00Z");
    day.setUTCDate(day.getUTCDate() - 1);
    return day.toISOString().slice(0, 10);
  });
  await page.goto(`/dashboard?period=day&date=${before}`);
  await expect(summary(page)).toHaveAttribute("data-bp-mode", "measured");
  await expect(summary(page)).toContainText("선택 기간 혈압 기록이 없어요");
  await expect(summary(page)).toContainText("기록 0일 · 측정 0회");
  await expect(summary(page)).not.toContainText("134 / 87");
  await expect(summary(page)).not.toContainText("생활습관 기반");
});

test("measurement details fit mobile and desktop widths", async ({ page }) => {
  await page.goto("/demo/studio-quarter");
  await summary(page).locator("summary").click();
  for (const width of [320, 390, 430, 1000]) {
    await page.setViewportSize({ width, height: 844 });
    await expectNoHorizontalOverflow(page);
    await expectNoHorizontalOverflow(page, ".measurement-details");
  }
  if (process.env.REXRUN_CAPTURE_PRESSURE) {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({
      path: process.env.REXRUN_CAPTURE_PRESSURE + "/measured-details.png",
      fullPage: true,
    });
    await summary(page).locator("summary").click();
    await page.screenshot({ path: process.env.REXRUN_CAPTURE_PRESSURE + "/measured-top.png" });
  }
});
