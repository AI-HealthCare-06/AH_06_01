import { expect, test } from "@playwright/test";

test("loading fills each phone viewport and keeps the game panel centered", async ({ page }) => {
  for (const [width, height] of [
    [360, 740],
    [412, 915],
    [320, 568],
    [915, 412],
  ]) {
    await page.setViewportSize({ width, height });
    await page.goto("/tests/fixtures/loading.html");
    const screen = page.getByRole("main", { name: "모험 로딩 화면" });
    await expect(screen).toBeVisible();
    const bounds = (await screen.boundingBox())!;
    expect(bounds.x).toBe(0);
    expect(bounds.y).toBe(0);
    expect(bounds.width).toBe(width);
    expect(bounds.height).toBe(height);
    await expect(page.getByRole("heading", { name: "지난 모험을 불러와요" })).toBeInViewport();
    await expect(page.getByRole("progressbar", { name: "모험 준비 중" })).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
    if (height > width) {
      const content = (await page.locator(".game-loading-screen__content").boundingBox())!;
      expect(Math.abs(content.y + content.height / 2 - height / 2)).toBeLessThan(3);
    }
  }
});

test("the applying screen shows real progress and honors reduced motion", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/tests/fixtures/loading.html?stage=applying");
  await expect(page.getByRole("heading", { name: "이제 모험을 시작해요" })).toBeVisible();
  await expect(page.getByRole("progressbar", { name: "업데이트 진행률" })).toHaveAttribute(
    "value",
    "100",
  );
  await expect(page.locator(".game-loading-screen__world img")).toHaveCSS("animation-name", "none");
  await page.screenshot({ path: "test-results/game-loading-mobile.png" });
});
