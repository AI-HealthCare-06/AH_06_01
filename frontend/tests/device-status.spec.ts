import { devices, expect, test } from "@playwright/test";

test.use({ timezoneId: "Asia/Seoul" });

test("device time, battery and network react to live device changes", async ({ page }) => {
  await page.clock.install({ time: new Date("2026-09-28T09:07:00Z") });
  await page.addInitScript(() => {
    const battery = Object.assign(new EventTarget(), { level: 0.63, charging: false });
    const connection = Object.assign(new EventTarget(), { type: "wifi", online: true });
    Object.defineProperty(navigator, "getBattery", {
      value: async () => battery,
      configurable: true,
    });
    Object.defineProperty(navigator, "connection", { value: connection, configurable: true });
    Object.defineProperty(navigator, "onLine", {
      get: () => connection.online,
      configurable: true,
    });
    Reflect.set(window, "mockBattery", battery);
    Reflect.set(window, "mockConnection", connection);
  });
  await page.goto("/home");
  await expect(page.locator(".device-time")).toHaveText("18:07");
  await expect(page.getByRole("img", { name: "배터리 63%", exact: true })).toBeVisible();
  await expect(page.locator(".network-status")).toHaveAttribute(
    "aria-label",
    "Wi-Fi 연결됨 (브라우저 기준)",
  );
  await page.clock.fastForward(61_000);
  await expect(page.locator(".device-time")).toHaveText("18:08");
  await page.evaluate(() => {
    const battery = Reflect.get(window, "mockBattery");
    battery.level = 0.28;
    battery.charging = true;
    battery.dispatchEvent(new Event("levelchange"));
    battery.dispatchEvent(new Event("chargingchange"));
    const connection = Reflect.get(window, "mockConnection");
    connection.type = "ethernet";
    connection.dispatchEvent(new Event("change"));
  });
  await expect(page.getByRole("img", { name: "배터리 28%, 충전 중", exact: true })).toBeVisible();
  await expect(page.locator(".charging-symbol")).toBeVisible();
  const filledRatio = await page.locator(".battery").evaluate((element) => {
    const style = getComputedStyle(element);
    const innerWidth =
      element.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
    return element.querySelector("i")!.getBoundingClientRect().width / innerWidth;
  });
  expect(filledRatio).toBeCloseTo(0.28, 1);
  await expect(page.locator(".network-status")).toHaveAttribute(
    "aria-label",
    "유선 네트워크 연결됨 (브라우저 기준)",
  );
  await page.evaluate(() => {
    Reflect.get(window, "mockConnection").online = false;
    window.dispatchEvent(new Event("offline"));
  });
  await expect(page.locator(".network-status")).toHaveAttribute("data-online", "false");
  await page.evaluate(() => {
    Reflect.get(window, "mockConnection").online = true;
    window.dispatchEvent(new Event("online"));
  });
  await expect(page.locator(".network-status")).toHaveAttribute("data-online", "true");
});

for (const mode of ["missing", "blocked"]) {
  test(`battery ${mode} does not show a fictitious battery level`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.addInitScript((state) => {
      Object.defineProperty(navigator, "getBattery", {
        configurable: true,
        value:
          state === "missing"
            ? undefined
            : async () => {
                throw new DOMException("Battery access denied", "NotAllowedError");
              },
      });
      Object.defineProperty(navigator, "connection", { configurable: true, value: undefined });
    }, mode);
    await page.goto("/home");
    await expect(page.locator(".battery-percent")).toHaveText("—");
    await expect(page.locator(".battery i")).toHaveCount(0);
    await expect(page.locator(".network-status")).toHaveAttribute(
      "aria-label",
      "네트워크 연결됨 (브라우저 기준)",
    );
    await page.getByRole("link", { name: "Quest", exact: true }).click();
    await expect(page.locator(".quest-list")).toBeVisible();
    await expect(page.locator(".battery-percent")).toHaveText("—");
    expect(errors).toEqual([]);
  });
}

test("all web tabs share screen height and navigation bounds with centered status icons", async ({
  page,
}) => {
  for (const viewport of [
    { width: 320, height: 694 },
    { width: 390, height: 844 },
    { width: 526, height: 694 },
    { width: 1440, height: 1000 },
  ]) {
    await page.setViewportSize(viewport);
    const bounds = [];
    for (const route of ["home", "quests", "dashboard", "shop"]) {
      await page.goto(`/${route}`);
      await page.evaluate(() => document.fonts.ready);
      if (route === "dashboard") await page.locator(".impact-card").waitFor();
      bounds.push(
        await page.evaluate(() => {
          const screen = document.querySelector(".main-screen")!.getBoundingClientRect();
          const nav = document.querySelector(".bottom-navigation")!.getBoundingClientRect();
          return {
            height: screen.height,
            navTop: nav.top - screen.top,
            navLeft: nav.left - screen.left,
            navWidth: nav.width,
            navHeight: nav.height,
          };
        }),
      );
      const offsets = await page.locator(".status-bar").evaluate((element) => {
        const bar = element.getBoundingClientRect();
        return [
          ".device-time",
          ".camera-dot",
          ".network-status",
          ".battery",
          ".battery-percent",
        ].map((selector) => {
          const icon = element.querySelector(selector)!.getBoundingClientRect();
          return Math.abs(bar.y + bar.height / 2 - icon.y - icon.height / 2);
        });
      });
      expect(Math.max(...offsets)).toBeLessThan(0.1);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
    }
    for (const bound of bounds) expect(bound).toEqual(bounds[0]);
  }
});

test("mobile tabs stay the same height without duplicating OS status indicators", async ({
  browser,
}) => {
  const context = await browser.newContext({ ...devices["iPhone 13"] });
  const page = await context.newPage();
  try {
    const heights = [];
    for (const route of ["home", "quests", "dashboard", "shop"]) {
      await page.goto(`http://127.0.0.1:5173/${route}`);
      await page.evaluate(() => document.fonts.ready);
      if (route === "dashboard") await page.locator(".impact-card").waitFor();
      await expect(page.locator(".status-bar")).toHaveCount(0);
      heights.push(
        await page
          .locator(".main-screen")
          .evaluate((element) => element.getBoundingClientRect().height),
      );
    }
    for (const height of heights) expect(height).toBe(heights[0]);
  } finally {
    await context.close();
  }
});
