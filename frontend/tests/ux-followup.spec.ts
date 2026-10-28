import { expect, test, type Page } from "@playwright/test";
test.setTimeout(60_000);
async function pause(page: Page) {
  await page.evaluate(async () => {
    const path = "/src/stores/game-store.ts";
    const { useGameStore } = await import(path);
    useGameStore.getState().suspendSession();
  });
}
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("rexrun-persona-mode", "true"));
});

test("holding a time arrow repeats, wraps, and stops on pointer release", async ({ page }) => {
  await page.goto("/daily-survey");
  await pause(page);
  await page.getByRole("button", { name: "다음", exact: true }).click();
  await page.getByRole("button", { name: "다음", exact: true }).click();
  await page.getByRole("button", { name: "취침 시각", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "취침 시각 설정", exact: true });
  await dialog.getByLabel("분", { exact: true }).fill("58");
  const arrow = dialog.getByRole("button", { name: "분 늘리기", exact: true });
  const box = (await arrow.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(700);
  await page.mouse.up();
  const value = await dialog.getByLabel("분", { exact: true }).inputValue();
  expect(Number(value)).toBeGreaterThanOrEqual(2);
  expect(Number(value)).toBeLessThan(15);
  await page.waitForTimeout(250);
  expect(await dialog.getByLabel("분", { exact: true }).inputValue()).toBe(value);
  await dialog.getByRole("button", { name: "시간 설정 닫기", exact: true }).click();
  await expect(dialog).toHaveCount(0);
});

test("sleep symptom sliders preserve zero, ten and a separate unknown response", async ({
  page,
}) => {
  await page.goto("/daily-survey");
  await pause(page);
  for (let i = 0; i < 6; i++) await page.getByRole("button", { name: "다음", exact: true }).click();
  const slider = page.getByRole("slider", { name: "코골이 정도" });
  await slider.focus();
  await page.keyboard.press("Home");
  await expect(slider).toHaveValue("0");
  await expect(page.locator(".survey-slider output")).toHaveText("0 / 10");
  await page.getByRole("button", { name: "모름", exact: true }).click();
  await expect(page.getByRole("button", { name: "모름", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await slider.focus();
  await page.keyboard.press("End");
  await expect(slider).toHaveValue("10");
  await page.getByRole("button", { name: "다음", exact: true }).click();
  const day = page.getByRole("slider", { name: "낮의 졸림 정도" });
  await day.focus();
  await page.keyboard.press("Home");
  await page.getByRole("button", { name: "다음", exact: true }).click();
  await page.getByRole("button", { name: "다음", exact: true }).click();
  await page.getByRole("button", { name: "오늘 기록 수정", exact: true }).click();
  const values = await page.evaluate(async () => {
    const p = "/src/stores/game-store.ts";
    const { useGameStore } = await import(p);
    const g = useGameStore.getState().game;
    return g.dailySurveys[g.date];
  });
  expect(values.snoringScore).toBe(10);
  expect(values.daytimeSleepinessScore).toBe(0);
  expect(values.daytimeSleepiness).toBe(false);
});

test("medication registration is a modal and supplements keep an editable ingredient field", async ({
  page,
}) => {
  await page.goto("/medications");
  await pause(page);
  await page.getByRole("button", { name: "+ 약 / 영양제 등록", exact: true }).click();
  const modal = page.getByRole("dialog", { name: "약 / 영양제 등록", exact: true });
  await expect(modal).toBeVisible();
  await modal.getByLabel("약 / 영양제 이름", { exact: true }).fill("비타민 예시");
  await modal.getByRole("radio", { name: "영양제", exact: true }).check();
  await expect(modal.getByLabel("성분", { exact: true })).toBeEnabled();
  await modal.getByLabel("성분", { exact: true }).fill("비타민 C");
  await expect(modal.getByRole("radio", { name: "영양제", exact: true })).toBeChecked();
  await modal.getByRole("button", { name: "항목 저장", exact: true }).click();
  await expect(modal).toHaveCount(0);
  await expect(page.getByRole("switch", { name: "복용 시간 알림", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "비타민 예시 수정", exact: true }).click();
  await expect(modal.getByLabel("성분", { exact: true })).toHaveValue("비타민 C");
  await modal.getByRole("button", { name: "취소", exact: true }).click();
});

test("profile picker filters by gender and preserves an animated GIF without converting it", async ({
  page,
}) => {
  await page.goto("/me");
  await pause(page);
  await page.getByRole("button", { name: "프로필 이미지 변경", exact: true }).click();
  const modal = page.getByRole("dialog", { name: "프로필 이미지 선택", exact: true });
  await expect(modal.getByRole("button", { name: /여성.*프로필 선택/ })).toHaveCount(0);
  await expect(modal.getByRole("button", { name: /남성.*프로필 선택/ })).toHaveCount(10);
  const data = Buffer.from(
    "R0lGODlhCAAIAIEAAP8AAAAAAAAAAAAAACH/C05FVFNDQVBFMi4wAwEAAAAh+QQADAAAACwAAAAACAAIAAAIDwABCBxIsKDBgwgTKkwYEAAh+QQBDAABACwAAAAACAAIAIEAAP8AAAAAAAAAAAAIDwABCBxIsKDBgwgTKkwYEAA7",
    "base64",
  );
  await modal
    .getByLabel("기기 이미지 또는 GIF 선택", { exact: true })
    .setInputFiles({ name: "avatar.gif", mimeType: "image/gif", buffer: data });
  await expect(modal.locator('.profile-avatar[data-avatar="custom"] img')).toHaveAttribute(
    "src",
    "data:image/gif;base64," + data.toString("base64"),
  );
  await modal.getByRole("button", { name: "닫기", exact: true }).click();
  await page.reload();
  await expect(page.locator('.member-avatar-button [data-avatar="custom"] img')).toHaveAttribute(
    "src",
    /^data:image\/gif;base64,/,
  );
});

test("settings rows keep equal heights, font settings scale text and back returns home", async ({
  page,
}) => {
  await page.goto("/me");
  await pause(page);
  const rows = await page
    .locator(".account-menu>button,.settings-summary-row")
    .evaluateAll((elements) => elements.map((e) => e.getBoundingClientRect().height));
  expect(Math.max(...rows) - Math.min(...rows)).toBeLessThan(1);
  const before = await page
    .getByRole("heading", { name: "MY PAGE", exact: true })
    .evaluate((e) => parseFloat(getComputedStyle(e).fontSize));
  await page.getByRole("button", { name: /글자 크기/ }).click();
  await page.getByRole("radio", { name: "더 크게 · 130%", exact: true }).check();
  await page.getByRole("button", { name: "닫기", exact: true }).click();
  const after = await page
    .getByRole("heading", { name: "MY PAGE", exact: true })
    .evaluate((e) => parseFloat(getComputedStyle(e).fontSize));
  expect(after).toBeGreaterThan(before * 1.2);
  for (const width of [320, 390, 430]) {
    await page.setViewportSize({ width, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  }
  await page.getByRole("button", { name: /뒤로가기/ }).click();
  await expect(page).toHaveURL(/\/home$/);
});

test("radar uses recorded progress and opens dashboard, whose values and calendar fit", async ({
  page,
}) => {
  await page.goto("/home");
  await pause(page);
  const radar = page.getByRole("link", { name: "DINO RADAR · 건강 대시보드 보기" });
  await expect(radar).toContainText("7일차");
  await expect(radar).not.toContainText("72일차");
  await radar.click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.locator(".hero-vitals")).toContainText("6.2시간");
  const height = await page
    .locator(".weekly-calendar>button")
    .first()
    .evaluate((e) => e.getBoundingClientRect().height);
  expect(height).toBeGreaterThanOrEqual(64);
  const padding = await page
    .locator(".calendar-toolbar")
    .evaluate((e) => parseFloat(getComputedStyle(e).paddingTop));
  expect(padding).toBeGreaterThanOrEqual(12);
});

test("game settings expose independent persistent BGM and SFX switches", async ({ page }) => {
  await page.goto("/home");
  await pause(page);
  await page.getByRole("button", { name: "게임 설정", exact: true }).click();
  const modal = page.getByRole("dialog", { name: "게임 설정", exact: true });
  const bgm = modal.getByRole("switch", { name: "배경 음악 BGM", exact: true }),
    sfx = modal.getByRole("switch", { name: "공격 효과음 SFX", exact: true });
  await bgm.click();
  await expect(bgm).toHaveAttribute("aria-checked", "false");
  await expect(sfx).toHaveAttribute("aria-checked", "true");
  await sfx.click();
  await modal.getByRole("button", { name: "닫기", exact: true }).click();
  await page.reload();
  await page.getByRole("button", { name: "게임 설정", exact: true }).click();
  await expect(bgm).toHaveAttribute("aria-checked", "false");
  await expect(sfx).toHaveAttribute("aria-checked", "false");
});
