import { devices, expect, test } from "@playwright/test";

test("device chrome stays visible in narrow desktop browser panels", async ({ page }) => {
  for (const width of [526, 320]) {
    await page.setViewportSize({ width, height: 694 });
    await page.goto("/home");
    await expect(page.locator(".status-bar")).toBeVisible();
    await expect(page.locator(".home-indicator")).toBeVisible();
  }
});

for (const device of ["iPhone 13", "Pixel 7"]) {
  test(`${device} uses OS chrome instead of a second status bar`, async ({ browser }) => {
    const context = await browser.newContext({ ...devices[device] });
    const page = await context.newPage();
    try {
      for (const route of ["home", "profile", "shop"]) {
        await page.goto(`http://127.0.0.1:5173/${route}`);
        await expect(page.locator(".mobile-screen")).toHaveAttribute(
          "data-device-preview",
          "false",
        );
        await expect(page.locator(".status-bar")).toHaveCount(0);
        await expect(page.locator(".home-indicator")).toHaveCount(0);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
          true,
        );
      }
    } finally {
      await context.close();
    }
  });
}

test("tablet desktop mode and native shells do not show simulated device chrome", async ({
  browser,
}) => {
  for (const runtime of ["tablet", "native"]) {
    const context = await browser.newContext({ viewport: { width: 1024, height: 768 } });
    await context.addInitScript((target) => {
      if (target === "native") {
        Reflect.set(window, "Capacitor", { isNativePlatform: () => true });
      } else {
        Object.defineProperty(navigator, "platform", { get: () => "MacIntel" });
        Object.defineProperty(navigator, "maxTouchPoints", { get: () => 5 });
      }
    }, runtime);
    const page = await context.newPage();
    try {
      await page.goto("http://127.0.0.1:5173/home");
      await expect(page.locator(".mobile-screen")).toHaveAttribute("data-device-preview", "false");
      await expect(page.locator(".status-bar")).toHaveCount(0);
    } finally {
      await context.close();
    }
  }
});
