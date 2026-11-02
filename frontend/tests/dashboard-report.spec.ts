import { expectNoHorizontalOverflow } from "./helpers/layout";
import { selectPixelOption } from "./helpers/controls";
import { expect, test } from "@playwright/test";
import { seedDashboardActivity } from "./helpers/dashboard";

test("period changes preserve the score animation and keep all sections in one scrollable report", async ({
  page,
}) => {
  await seedDashboardActivity(page);
  await page.goto("/dashboard/report");
  const score = page.locator(".score-number .number-visual");
  await expect(score).toHaveAttribute("data-value", "75");
  await page.locator(".health-score").evaluate((element) => {
    Reflect.set(window, "initialScore", element);
    Reflect.set(
      window,
      "initialScoreFill",
      element.querySelector(".metric-fill")!.getAnimations()[0],
    );
  });
  const report = page.getByRole("region", { name: "REPORT", exact: true });
  for (const period of ["day", "month", "year", "week"]) {
    await selectPixelOption(page.getByRole("combobox", { name: "건강 변화 조회 기간" }), period);
    await expect(score).toHaveAttribute("data-value", period === "day" ? "50" : "75");
    expect(
      await page
        .locator(".health-score")
        .evaluate(
          (element) =>
            element === Reflect.get(window, "initialScore") &&
            element.querySelector(".metric-fill")!.getAnimations()[0] ===
              Reflect.get(window, "initialScoreFill"),
        ),
    ).toBe(true);
    await expect(report.locator(".health-growth-card")).toHaveCount(1);
    await expect(
      report.getByRole("region", { name: "선택 기간 건강 기록", exact: true }),
    ).toHaveCount(1);
    await expect(report.locator(".health-trend")).toHaveCount(1);
  }
  await expect(report.locator(".impact-card,.risk-grid")).toHaveCount(0);
  const scroll = page.getByLabel("대시보드 리포트 스크롤", { exact: true });
  for (const width of [320, 526]) {
    await page.setViewportSize({ width, height: 844 });
    expect(await scroll.evaluate((element) => getComputedStyle(element).overflowY)).toBe("visible");
    await report.locator(".health-trend").scrollIntoViewIfNeeded();
    await expect(report.locator(".health-trend")).toBeInViewport();
    expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
    await expectNoHorizontalOverflow(page, '[aria-label="대시보드 리포트 스크롤"]');
    await report
      .getByRole("region", { name: "선택 기간 건강 기록", exact: true })
      .scrollIntoViewIfNeeded();
    await expect(report.getByRole("region", { name: "선택 기간 핵심 지표" })).toBeInViewport();
  }
});
