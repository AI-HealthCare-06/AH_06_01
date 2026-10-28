import { expect, test } from "@playwright/test";
import analysis from "./fixtures/quest-analysis-demo.json" with { type: "json" };
test.use({ hasTouch: true });
test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-10-22T03:00:00Z"));
  await page.route("**/predictions/bp-stage", async (route) => {
    expect(route.request().postDataJSON()).toEqual({ demo_persona: "htn-diabetes-v1" });
    await route.fulfill({ json: analysis });
  });
});
test("demo records are isolated, and Sub Quest is based on the previous day and actual response contract", async ({
  page,
}) => {
  await page.addInitScript(() => {
    localStorage.setItem("rexrun-persona-mode", "true");
    localStorage.setItem("rexrun-demo-game-v1", "custom-save-preserved");
  });
  await page.goto("/quests");
  await expect(page.locator(".page-heading")).toContainText("나의 건강 습관");
  await expect(
    page.locator(".weekly-reward,.quest-summary-reward,.quest-summary-power"),
  ).toHaveCount(0);
  await expect(page.locator(".quest-weekly-inline")).toContainText("이번 주 달성");
  await expect(page.locator(".quest-summary .summary-track")).toHaveCSS("height", "14px");
  await page.getByRole("tab", { name: "Sub Quest", exact: true }).click();
  await expect(page.locator(".sub-quest-card")).toHaveCount(4);
  await expect(page.locator(".sub-quest-panel")).toContainText("5.6시간");
  await expect(page.locator(".sub-quest-panel")).toContainText("4,700보");
  await expect(page.locator(".model-pipeline")).toContainText("확인 항목 1 / 10");
  await page.getByRole("button", { name: /01 약 \/ 영양제 복용/ }).click();
  await expect(page.getByRole("dialog")).toContainText("오늘 등록된 모든 복약·투약 시간");
  await page.keyboard.press("Escape");
  expect(await page.evaluate(() => localStorage.getItem("rexrun-demo-game-v1"))).toBe(
    "custom-save-preserved",
  );
  await page.goto("/medications");
  const records = await page.evaluate(
    () => JSON.parse(localStorage.getItem("rexrun-persona:rexrun-medications-v1")!).medications,
  );
  expect(records.map((m: { name: string; times: string[] }) => [m.name, m.times.length])).toEqual([
    ["고혈압약", 3],
    ["인슐린", 1],
  ]);
});
test("demo charts, circular rings and merged date controls fit phone widths", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("rexrun-persona-mode", "true"));
  for (const width of [320, 390, 430]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto("/dashboard");
    await expect(page.locator(".score-ring svg circle")).toHaveCount(6);
    await expect(page.locator(".score-ring svg path")).toHaveCount(0);
    await expect(page.getByLabel("저장된 건강 기록 추이", { exact: true })).toBeVisible();
    const week = await page.getByLabel("주간 달력", { exact: true }).boundingBox();
    const range = await page.locator(".calendar-disclosure.dashboard-range-label").boundingBox();
    expect(range!.y).toBeGreaterThan(week!.y);
    await expect(page.locator(".calendar-disclosure")).not.toContainText("날짜 설정");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    expect(
      await page.locator(".main-content").evaluate((e) => e.scrollWidth <= e.clientWidth),
    ).toBe(true);
  }
});
test("skin and dinosaur selection respond to real touch swipes without switching the main tab", async ({
  page,
  context,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/character");
  const session = await context.newCDPSession(page);
  for (const selector of [".vault-roster", ".vault-skin-grid"]) {
    const region = page.locator(selector);
    await region.scrollIntoViewIfNeeded();
    const before = await region.locator("[aria-pressed='true']").getAttribute("data-item-id");
    const box = (await region.boundingBox())!;
    const x = box.x + box.width * 0.7,
      y = box.y + box.height / 2;
    await session.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
    for (let i = 1; i <= 12; i++) {
      await session.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [{ x: x - i * 7, y }],
      });
      await page.waitForTimeout(16);
    }
    await page.waitForTimeout(150);
    await session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await expect
      .poll(() => region.locator("[aria-pressed='true']").getAttribute("data-item-id"))
      .not.toBe(before);
    await expect(page).toHaveURL(/\/character$/);
  }
  await expect(
    page.getByRole("button", { name: /다음 스킨|이전 스킨|다음 공룡|이전 공룡/ }),
  ).toHaveCount(0);
});
