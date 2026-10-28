import { expectNoHorizontalOverflow } from "./helpers/layout";
import { selectPixelOption } from "./helpers/controls";
import { expect, test } from "@playwright/test";

test("period changes preserve the score animation and keep all sections in one scrollable report", async ({
  page,
}) => {
  await page.goto("/dashboard/report");
  const score = page.locator(".score-number .number-visual");
  await expect(score).toHaveAttribute("data-value", "82");
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
    await expect(score).toHaveAttribute("data-value", "82");
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
    await expect(report.getByRole("link", { name: "질환 위험도 상세 보기" })).toHaveCount(1);
    await expect(report.locator(".health-trend")).toHaveCount(1);
  }
  await expect(report.locator(".impact-card")).toHaveCount(1);
  const scroll = page.getByLabel("대시보드 리포트 스크롤", { exact: true });
  for (const width of [320, 526]) {
    await page.setViewportSize({ width, height: 844 });
    expect(await scroll.evaluate((element) => getComputedStyle(element).overflowY)).toBe("visible");
    await report.locator(".prediction-note").scrollIntoViewIfNeeded();
    await expect(report.locator(".prediction-note")).toBeInViewport();
    expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
    await expectNoHorizontalOverflow(page, '[aria-label="대시보드 리포트 스크롤"]');
    await report.getByRole("link", { name: "질환 위험도 상세 보기" }).scrollIntoViewIfNeeded();
    await expect(report.locator(".risk-tile").last()).toBeInViewport();
  }
});
