import { selectPixelOption } from "./helpers/controls";
import { expect, test } from "@playwright/test";

test("skin carousel centers its selection and owned items open in a modal", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  for (const width of [320, 390, 526]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto("/character");
    const region = page.locator(".vault-skin-grid");
    for (const skin of ["바다 탐험가", "황금빛 용사", "오리지널"]) {
      await page.getByRole("button", { name: `티라노 ${skin} 스킨 선택`, exact: true }).click();
      await expect
        .poll(async () =>
          region.evaluate((element) => {
            const selected = element
              .querySelector('[aria-pressed="true"]')!
              .getBoundingClientRect();
            const bounds = element.getBoundingClientRect();
            return Math.abs(
              selected.left + selected.width / 2 - bounds.left - element.clientWidth / 2,
            );
          }),
        )
        .toBeLessThan(2);
      await expect(page.getByLabel("현재 스킨")).toContainText(skin);
    }
    await expect(page.locator(".vault-roster").getByRole("button")).toHaveCount(6);
    const slot = page.getByRole("button", { name: "머리 장식 관리 · 미장착", exact: true });
    await slot.click();
    await expect(page.getByRole("dialog", { name: "보유 머리 장식", exact: true })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(slot).toBeFocused();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  }
});

test("mobile summary links to a separate report and keeps the selected period and date", async ({
  page,
}) => {
  await page.goto("/dashboard?period=month&date=2026-10-10");
  await expect(page.locator(".dashboard-summary")).toBeVisible();
  await expect(page.locator(".risk-tile, .model-status, .ranker-status")).toHaveCount(0);
  await page.getByRole("link", { name: "상세 건강 보고서 웹으로 보기" }).click();
  await expect(page).toHaveURL(/\/dashboard\/report\?period=month&date=2026-10-10/);
  await expect(page.locator(".bp-report, .health-trend")).toHaveCount(2);
  await expect(page.locator(".dashboard-summary, .bottom-navigation")).toHaveCount(0);
  await selectPixelOption(page.getByRole("combobox", { name: "건강 변화 조회 기간" }), "year");
  await expect(page.locator(".health-score h3")).toContainText("YEARLY");
  await page.reload();
  await expect(page.getByRole("combobox", { name: "건강 변화 조회 기간" })).toContainText("연간");
  await page.getByRole("link", { name: "‹ 요약으로 돌아가기" }).click();
  await expect(page.locator(".dashboard-summary")).toBeVisible();
  await expect(page.getByRole("combobox", { name: "건강 변화 조회 기간" })).toContainText("연간");
});

test("navigation selected tiles use the Shared components paper background and exported icons", async ({
  page,
}) => {
  for (const [route, key] of [
    ["/shop", "shop"],
    ["/character", "character"],
    ["/home", "home"],
    ["/quests", "quests"],
    ["/dashboard", "dashboard"],
  ]) {
    await page.goto(route);
    const selected = page.locator('.bottom-navigation [aria-current="page"]');
    await expect(selected).toHaveCount(1);
    await expect(selected).toHaveCSS("background-color", "rgb(243, 231, 200)");
    await expect(selected.locator("img")).toHaveAttribute(
      "src",
      `/assets/navigation/${key}-active.svg`,
    );
    const box = (await selected.locator("img").boundingBox())!;
    expect(box.width).toBe(25);
    expect(box.height).toBe(25);
    for (const icon of await page.locator(".navigation-icon").all())
      await expect
        .poll(() => icon.evaluate((node) => (node as HTMLImageElement).naturalWidth))
        .toBe(25);
  }
});
