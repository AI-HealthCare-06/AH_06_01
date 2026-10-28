import { expect, test } from "@playwright/test";
import { setMedicationTime } from "./fixtures/medication-time";

test.use({ isMobile: true, hasTouch: true });

for (const width of [320, 412]) {
  test(`pixel medication picker saves sorted times and cancels edits at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 892 });
    await page.goto("/medications");
    await page.getByRole("button", { name: "+ 약 / 영양제 등록" }).click();
    await page.getByLabel("약 / 영양제 이름", { exact: true }).fill("합성 테스트 약");
    await setMedicationTime(page, 1, "18:00");
    await page.getByRole("button", { name: "+ 시간 추가" }).click();
    await setMedicationTime(page, 2, "08:00");
    await page.getByRole("button", { name: "+ 시간 추가" }).click();
    await setMedicationTime(page, 3, "12:00");
    await page.getByRole("button", { name: "복용 시간 3", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "복용 시간 3 설정", exact: true });
    await dialog.getByRole("textbox", { name: "시", exact: true }).fill("24");
    await expect(dialog.getByRole("button", { name: "시간 적용" })).toBeDisabled();
    await dialog.getByRole("textbox", { name: "시", exact: true }).fill("23");
    await dialog.getByRole("textbox", { name: "분", exact: true }).fill("59");
    await page.screenshot({ path: `test-results/pixel-time-picker-${width}.png` });
    const bounds = (await dialog.boundingBox())!;
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
    expect(bounds.y).toBeGreaterThanOrEqual(0);
    await page.keyboard.press("Escape");
    await expect(page.getByRole("button", { name: "복용 시간 3", exact: true })).toHaveAttribute(
      "data-time",
      "12:00",
    );
    await expect(page.getByRole("button", { name: "복용 시간 3", exact: true })).toBeFocused();
    await page.getByRole("button", { name: "항목 저장", exact: true }).click();
    await expect(page.locator(".medication-schedule time")).toHaveText(["08:00", "12:00", "18:00"]);
    const saved = await page.evaluate(
      () => JSON.parse(localStorage.getItem("rexrun-medications-v1")!).medications[0].times,
    );
    expect(saved).toEqual(["08:00", "12:00", "18:00"]);
    await page.reload();
    await expect(page.locator(".medication-schedule time")).toHaveText(saved);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  });
}

test("existing metric waist measurements display in inches without changing on an untouched save", async ({
  page,
}) => {
  await page.goto("/home");
  await page.evaluate(async () => {
    const path = "/src/stores/profile-store.ts";
    const { useProfileStore } = await import(path);
    const state = useProfileStore.getState();
    state.setProfile({ ...state.profile, waistCm: 85 });
    state.completeOnboarding();
  });
  await page.getByRole("link", { name: "마이페이지", exact: true }).click();
  await page.getByRole("button", { name: /건강 정보 수정/ }).click();
  for (let i = 0; i < 8; i++) await page.locator(".survey-actions button[type=submit]").click();
  await expect(page.getByLabel("허리둘레", { exact: true })).toHaveValue("33.46");
  await expect(page.getByLabel("허리둘레", { exact: true }).locator("..")).toContainText("인치");
  for (let i = 0; i < 3; i++) await page.locator(".survey-actions button[type=submit]").click();
  const waist = await page.evaluate(async () => {
    const path = "/src/stores/profile-store.ts";
    const { useProfileStore } = await import(path);
    return useProfileStore.getState().profile.waistCm;
  });
  expect(waist).toBe(85);
});

test("dashboard date controls collapse without losing the report selection", async ({ page }) => {
  await page.setViewportSize({ width: 412, height: 892 });
  await page.goto("/dashboard?period=month&date=2026-10-10");
  const period = page.getByRole("combobox", { name: "건강 변화 조회 기간" });
  await expect(period).toContainText("월간");
  const before = (await page.locator(".summary-score").boundingBox())!.y;
  await page.getByRole("button", { name: "날짜 설정 접기", exact: true }).click();
  await expect(period).toBeHidden();
  await expect(page.getByLabel("주간 달력", { exact: true })).toBeVisible();
  await expect(page.locator(".calendar-disclosure")).toContainText("2026-10-01 ~ 2026-10-10");
  expect((await page.locator(".summary-score").boundingBox())!.y).toBeLessThan(before);
  await page.screenshot({ path: "test-results/dashboard-dates-collapsed.png" });
  await page.getByRole("button", { name: "날짜 설정 펼치기", exact: true }).click();
  await expect(period).toContainText("월간");
  await expect(page.getByRole("button", { name: "조회 기준 날짜" })).toHaveAttribute(
    "data-date",
    "2026-10-10",
  );
  await page.getByRole("link", { name: "상세 건강 보고서 웹으로 보기" }).click();
  await expect(page).toHaveURL(/period=month&date=2026-10-10/);
});
