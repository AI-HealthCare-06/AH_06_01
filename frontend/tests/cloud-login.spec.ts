import { test, expect } from "@playwright/test";

test.describe("mobile account login", () => {
  test.skip(process.env.REXRUN_AUTH_UI !== "1", "Uses an isolated cloud-enabled UI server");
  test.use({ isMobile: true, hasTouch: true });
  for (const width of [320, 360, 390, 412]) {
    test(`readable card contains every action at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 844 });
      await page.emulateMedia({ colorScheme: "dark" });
      await page.goto("/login");
      const card = page.locator(".cloud-auth-card");
      await expect(card).toBeVisible();
      await page.evaluate(() => document.fonts.ready);
      const box = (await card.boundingBox())!;
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      for (const control of await card.locator("input, button, a").all()) {
        const bounds = (await control.boundingBox())!;
        expect(bounds.height).toBeGreaterThanOrEqual(44);
        expect(bounds.x).toBeGreaterThanOrEqual(box.x);
        expect(bounds.x + bounds.width).toBeLessThanOrEqual(box.x + box.width);
        expect(bounds.y + bounds.height).toBeLessThanOrEqual(box.y + box.height);
      }
      const contrast = await page
        .locator(".cloud-auth-field")
        .first()
        .evaluate((el) => {
          const rgb = (s: string) => s.match(/\d+/g)!.slice(0, 3).map(Number);
          const luminance = (c: number[]) =>
            c
              .map((n) => {
                const v = n / 255;
                return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
              })
              .reduce((a, n, i) => a + n * [0.2126, 0.7152, 0.0722][i], 0);
          const a = luminance(rgb(getComputedStyle(el).color));
          const b = luminance(rgb(getComputedStyle(el.closest("form")!).backgroundColor));
          return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
        });
      expect(contrast).toBeGreaterThanOrEqual(4.5);
      if (width === 390)
        await page.screenshot({ path: "test-results/mobile-login-fixed.png", fullPage: true });
    });
  }
  test("keyboard-sized viewport and signup remain scrollable", async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 360 });
    await page.goto("/signup");
    const password = page.getByLabel("비밀번호", { exact: true });
    await password.focus();
    await expect(password).toBeInViewport();
    const submit = page.getByRole("button", { name: "가입하기", exact: true });
    await submit.scrollIntoViewIfNeeded();
    await expect(submit).toBeInViewport();
    await page.getByRole("link", { name: "이미 계정이 있어요" }).click();
    await expect(page.getByRole("group", { name: "소셜 로그인" })).toBeVisible();
  });
  test("failed login expands the card without spilling social actions", async ({ page }) => {
    await page.route("**/auth/v1/token*", (route) =>
      route.fulfill({
        status: 400,
        contentType: "application/json",
        body: JSON.stringify({
          error: "invalid_grant",
          error_description: "Invalid login credentials",
        }),
      }),
    );
    await page.goto("/login");
    await page.getByLabel("이메일", { exact: true }).fill("ui-only@example.invalid");
    await page.getByLabel("비밀번호", { exact: true }).fill("synthetic-password");
    await page.getByRole("button", { name: "로그인", exact: true }).click();
    await expect(page.locator(".cloud-auth-message")).toContainText("로그인하지 못했어요");
    const card = (await page.locator(".cloud-auth-card").boundingBox())!;
    const social = (await page.locator(".cloud-social").boundingBox())!;
    expect(social.y + social.height).toBeLessThan(card.y + card.height);
  });
});
