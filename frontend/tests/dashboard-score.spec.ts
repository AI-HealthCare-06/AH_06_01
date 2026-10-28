import { expect, test } from "@playwright/test";
import { seedDashboardActivity } from "./helpers/dashboard";
import { selectPixelOption } from "./helpers/controls";
import { expectNoHorizontalOverflow } from "./helpers/layout";

test("synthetic demo records drive both week and day scores on mobile", async ({
  page,
}, testInfo) => {
  await page.clock.setFixedTime(new Date("2026-10-28T03:00:00Z"));
  await page.addInitScript(() => localStorage.setItem("rexrun-persona-mode", "true"));
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/dashboard");
  await expect(page.locator(".score-number")).toHaveText("79");
  await expect(page.locator(".hero-vitals")).toContainText("20 / 28");
  await expect(page.locator(".hero-vitals")).toContainText("평균 6.1시간");
  for (const width of [320, 390, 534]) {
    await page.setViewportSize({ width, height: 844 });
    await expectNoHorizontalOverflow(page);
    await page.screenshot({
      path: testInfo.outputPath(`record-score-${width}.png`),
      fullPage: true,
    });
  }
  await selectPixelOption(page.getByRole("combobox", { name: "건강 변화 조회 기간" }), "day");
  await expect(page.locator(".score-number")).toHaveText("70");
  await expect(page.locator(".hero-vitals")).toContainText("2 / 4");
});

test("score, rings, history and report react to actual records and period selection", async ({
  page,
}) => {
  await seedDashboardActivity(page);
  const score = page.locator(".score-number");
  await expect(score).toHaveText("75");
  await expect(page.locator(".hero-vitals")).toContainText("6 / 8");
  await expect(page.locator(".hero-delta")).toContainText("지난주 비교 기록 부족");
  const chart = page.locator(".health-trend [role=img]");
  await expect(chart).toHaveAttribute("aria-label", /2026-10-27 100점, 2026-10-28 50점/);
  await expect(page.locator(".trend-column[data-missing=true]")).toHaveCount(5);
  await selectPixelOption(page.getByRole("combobox", { name: "건강 변화 조회 기간" }), "day");
  await expect(score).toHaveText("50");
  await expect(page.locator(".hero-delta")).toContainText("어제 대비 -50점");

  // Simulate the same live device update consumed by the health connector.
  // Crossing 6,000 steps also completes the walk quest through the real store.
  await page.evaluate(async () => {
    const path = "/src/stores/game-store.ts";
    const { useGameStore } = await import(path);
    useGameStore.getState().syncSteps({
      date: "2026-10-28",
      count: 6000,
      source: "health-connect",
      syncedAt: Date.now() + 1000,
    });
  });
  await expect(score).toHaveText("75");
  await expect(page.locator(".hero-vitals")).toContainText("3 / 4");
  await expect(page.locator(".hero-delta")).toContainText("어제 대비 -25점");
  await expect(page.locator(".stitch-metric-value strong")).toHaveText("75/ 100");
  await page.getByRole("link", { name: "상세 건강 보고서 웹으로 보기" }).click();
  await expect(score).toHaveText("75");
  await expect(page.locator(".report-score-change")).toHaveText("어제 대비 -25점");
  await expect(chart).toHaveAttribute("aria-label", "2026-10-28 75점");
});

test("missing records never display a demo score, and score help fits small phones", async ({
  page,
}) => {
  await page.goto("/dashboard?period=day&date=2026-10-10");
  await expect(page.locator(".score-number")).toHaveText("—");
  await expect(page.locator(".hero-delta")).toContainText("아직 점수를 계산할 기록이 없어요");
  await expect(page.locator(".trend-column[data-missing=true]")).toHaveCount(1);
  for (const width of [320, 390, 534]) {
    await page.setViewportSize({ width, height: 844 });
    await page.getByRole("button", { name: "건강 점수 설명", exact: true }).click();
    const help = page.getByRole("tooltip");
    await expect(help).toContainText("같은 비중");
    const bounds = (await help.boundingBox())!;
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
    await expectNoHorizontalOverflow(page);
    await page.keyboard.press("Escape");
  }
});
