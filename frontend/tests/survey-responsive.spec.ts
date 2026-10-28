import { expect, test } from "@playwright/test";
import { setMedicationTime } from "./fixtures/medication-time";

test.use({ isMobile: true, hasTouch: true });

for (const [width, height] of [
  [320, 568],
  [360, 740],
  [384, 832],
  [412, 892],
  [430, 932],
  [600, 960],
  [892, 412],
]) {
  test(`mobile shell fills ${width}×${height} without side gutters`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    for (const route of ["/login", "/profile", "/home", "/character", "/shop", "/dashboard"]) {
      await page.goto(route);
      const screen = page.locator(".mobile-screen");
      await expect(screen).toHaveAttribute("data-device-preview", "false");
      const bounds = (await screen.boundingBox())!;
      expect(bounds.x).toBe(0);
      expect(bounds.width).toBe(width);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
    }
  });
}

test("eleven short survey pages keep navigation visible on an S25-sized viewport", async ({
  page,
}) => {
  await page.setViewportSize({ width: 412, height: 892 });
  await page.addInitScript(() => localStorage.setItem("rexrun-onboarding-completed", "true"));
  await page.goto("/profile");
  for (let index = 0; index < 11; index++) {
    await expect(page.getByLabel("설문 페이지")).toHaveText(`${index + 1} / 11`);
    const next = page.locator(".survey-actions button[type=submit]");
    await expect(next).toBeInViewport();
    expect(await page.evaluate(() => scrollY)).toBe(0);
    if (index === 4) {
      const history = page.getByLabel("특수 이력 / 주의사항");
      await expect(history).toHaveCSS("resize", "none");
      const before = (await history.boundingBox())!;
      await history.fill("합성 테스트 주의사항\n".repeat(60));
      const after = (await history.boundingBox())!;
      expect(after.height).toBeCloseTo(before.height, 3);
      expect(after.width).toBeCloseTo(before.width, 3);
      await expect(next).toBeInViewport();
    }
    if (index < 10) await next.click();
  }
  await page.screenshot({ path: "test-results/survey-confirmation-s25.png" });
});

test("medication editor pages retain draft values and prevent skipping unsaved medication", async ({
  page,
}) => {
  await page.addInitScript(() => localStorage.setItem("rexrun-onboarding-completed", "true"));
  await page.goto("/profile");
  for (let i = 0; i < 5; i++) await page.locator(".survey-actions button[type=submit]").click();
  await page.getByRole("button", { name: "+ 약 / 영양제 등록" }).click();
  await expect(page.locator(".survey-actions button:enabled")).toHaveCount(0);
  await page.getByLabel("약 / 영양제 이름", { exact: true }).fill("합성 약");
  await page.getByRole("button", { name: "다음: 복용 항목" }).click();
  await page.getByRole("button", { name: "다음: 복용 시간", exact: true }).click();
  await setMedicationTime(page, 1, "12:30");
  await page.getByRole("button", { name: "이전 항목" }).click();
  await page.getByRole("button", { name: "이전 항목" }).click();
  await expect(page.getByLabel("약 / 영양제 이름", { exact: true })).toHaveValue("합성 약");
  await page.getByRole("button", { name: "다음: 복용 항목" }).click();
  await page.getByRole("button", { name: "다음: 복용 시간", exact: true }).click();
  await expect(page.getByLabel("복용 시간 1", { exact: true })).toHaveAttribute(
    "data-time",
    "12:30",
  );
  await page.getByRole("button", { name: "항목 저장", exact: true }).click();
  await expect(page.getByRole("button", { name: "다음: 생활습관", exact: true })).toBeEnabled();
});
