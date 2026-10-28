import { expect, test } from "@playwright/test";
test("quest help restores focus and does not create evidence or grant a reward", async ({
  page,
}) => {
  await page.goto("/quests/water");
  const trigger = page.getByRole("button", { name: "퀘스트 설명", exact: true });
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await trigger.focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: "왜 이 퀘스트인가요?", exact: true });
  await expect(dialog).toContainText("물 마시기 실천");
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await expect(page.locator(".complete-quest")).toBeDisabled();
});

test("pixel quest sheet keeps readable badges, hints and actions on mobile widths", async ({
  page,
}, testInfo) => {
  for (const width of [320, 390, 430, 534]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto("/quests/water");
    await page.evaluate(() => document.fonts.ready);
    await expect(page.getByRole("link", { name: "물 마시기 동작 인증하기" })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    for (const selector of [".quest-goal-badge", ".quest-progress-value"]) {
      const contrast = await page.locator(selector).evaluate((el) => {
        const rgb = (value: string) => value.match(/\d+/g)!.slice(0, 3).map(Number);
        const luminance = (channels: number[]) =>
          channels
            .map((n) => {
              const c = n / 255;
              return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
            })
            .reduce((sum, n, i) => sum + n * [0.2126, 0.7152, 0.0722][i], 0);
        const style = getComputedStyle(el);
        const a = luminance(rgb(style.color)),
          b = luminance(rgb(style.backgroundColor));
        return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
      });
      expect(contrast).toBeGreaterThanOrEqual(7);
    }
    for (const help of await page.locator(".quest-help-button").all()) {
      const bounds = (await help.boundingBox())!;
      expect(bounds.width).toBeGreaterThanOrEqual(44);
      expect(bounds.height).toBeGreaterThanOrEqual(44);
    }
    await page
      .locator(".quest-sheet")
      .screenshot({ path: testInfo.outputPath("quest-" + width + ".png") });
  }
});
