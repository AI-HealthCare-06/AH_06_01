import { test, expect } from "@playwright/test";

test("all Figma routes render local assets with no browser errors", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  for (const route of [
    "home",
    "quests",
    "dashboard",
    "shop",
    "login",
    "profile",
    "dinosaur",
    "first-result",
    "quests/walk",
    "reward",
    "buff",
    "risk",
    "withered",
    "me",
  ]) {
    await page.goto(`/${route}`);
    await page.locator(".mobile-screen").waitFor();
    await page.evaluate(() => document.fonts.ready);
    const broken = await page.locator("img").evaluateAll(async (imgs) => {
      await Promise.all(imgs.map((img) => img.decode().catch(() => {})));
      return imgs
        .filter(
          (img) => !img.naturalWidth || !new URL(img.src).pathname.startsWith("/assets/figma/"),
        )
        .map((img) => img.src);
    });
    expect(broken, route).toEqual([]);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      route,
    ).toBe(true);
  }
  expect(errors).toEqual([]);
});
test("quest completion persists and cannot grant a duplicate reward", async ({ page }) => {
  await page.goto("/quests/walk");
  await page.getByRole("button", { name: "완료 체크하기" }).click();
  await expect(page).toHaveURL(/\/reward$/);
  await expect(page.locator(".reward-coins")).toHaveText("+30 COIN");
  await page.goto("/shop");
  await expect(page.locator(".wallet-balance>strong")).toHaveText("1,310");
  await page.reload();
  await expect(page.locator(".wallet-balance>strong")).toHaveText("1,310");
  await page.goto("/quests/walk");
  await expect(page.getByRole("button", { name: "오늘 완료한 퀘스트예요" })).toBeDisabled();
});
test("daily bonus can be claimed once and demo products never spend coins", async ({ page }) => {
  await page.goto("/shop");
  await page.locator(".daily-bonus").click();
  await expect(page.locator(".wallet-balance>strong")).toHaveText("1,290");
  await expect(page.locator(".daily-bonus")).toBeDisabled();
  await page.reload();
  await expect(page.locator(".daily-bonus")).toBeDisabled();
  await page.getByRole("button", { name: /닭가슴살 세트/ }).click();
  await expect(page.locator(".wallet-balance>strong")).toHaveText("1,290");
});
test("onboarding validates input and keeps health and credentials out of storage", async ({
  page,
}) => {
  await page.goto("/login");
  await page.getByRole("button", { name: "다음", exact: true }).click();
  await expect(page).toHaveURL(/\/profile$/);
  await page.getByRole("spinbutton", { name: "키", exact: true }).fill("0");
  await page.getByRole("button", { name: "공룡 깨우기" }).click();
  await expect(page).toHaveURL(/\/profile$/);
  await page.getByRole("spinbutton", { name: "키", exact: true }).fill("170");
  await page.getByRole("spinbutton", { name: "몸무게", exact: true }).fill("70");
  await expect(page.locator(".bmi-card strong")).toHaveText("24.2");
  await page.getByRole("button", { name: "공룡 깨우기" }).click();
  await expect(page).toHaveURL(/\/dinosaur$/);
  await page.getByRole("button", { name: /트리케라/ }).click();
  await page.getByRole("link", { name: "모험 시작하기" }).click();
  await expect(page.locator(".initial-scene>strong")).toContainText("트리케라");
  const persisted = await page.evaluate(() => JSON.stringify(localStorage));
  for (const sensitive of [
    "height",
    "weight",
    "glucose",
    "bloodPressure",
    "hello@rexrun.com",
    "rexrun12",
  ])
    expect(persisted).not.toContain(sensitive);
  await page.goto("/me");
  await page.getByRole("button", { name: "로그아웃" }).click();
  await expect(page).toHaveURL(/\/login$/);
});
test("mobile and desktop layouts keep primary navigation usable", async ({ page }) => {
  for (const width of [320, 390, 430, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/home");
    await page.getByRole("link", { name: "Quest", exact: true }).click();
    await expect(page).toHaveURL(/\/quests$/);
    await page.getByRole("link", { name: "Dashboard", exact: true }).click();
    await expect(page.locator(".health-score")).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
  }
});

test("settings dialog closes with Escape and restores focus", async ({ page }) => {
  await page.goto("/me");
  const settings = page.getByRole("button", { name: /알림 설정/ });
  await settings.click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(settings).toBeFocused();
});
