import { expect, test, type Page } from "@playwright/test";

async function pause(page: Page) {
  await page.evaluate(async () => {
    const path = "/src/stores/game-store.ts";
    const { useGameStore } = await import(path);
    useGameStore.getState().suspendSession();
  });
}
async function setTime(page: Page, label: string, hour: string, minute: string) {
  await page.getByRole("button", { name: label, exact: true }).click();
  const modal = page.getByRole("dialog", { name: label + " 설정", exact: true });
  await modal.getByLabel("시", { exact: true }).fill(hour);
  await modal.getByLabel("분", { exact: true }).fill(minute);
  await modal.getByRole("button", { name: "시간 적용", exact: true }).click();
}
async function next(page: Page) {
  await page.getByRole("button", { name: "다음", exact: true }).click();
}
async function optionalToReview(page: Page) {
  for (let i = 0; i < 6; i++)
    await page.getByRole("button", { name: "이 항목 건너뛰기", exact: true }).click();
}
async function answers(page: Page) {
  await page
    .getByRole("radiogroup", { name: "오늘 혈압 측정 여부" })
    .getByRole("radio", { name: "측정했어요", exact: true })
    .check();
  await page.getByLabel("아침 수축기", { exact: true }).fill("148");
  await page.getByLabel("아침 이완기", { exact: true }).fill("94");
  await next(page);
  await page
    .getByRole("radiogroup", { name: "안정 시 맥박 측정 여부" })
    .getByRole("radio", { name: "측정했어요", exact: true })
    .check();
  await page.getByLabel("안정 시 맥박", { exact: true }).fill("78");
  await next(page);
  await page
    .getByRole("radiogroup", { name: "어젯밤 수면 시간 확인 여부" })
    .getByRole("radio", { name: "시간을 확인했어요", exact: true })
    .check();
  await setTime(page, "취침 시각", "00", "30");
  await setTime(page, "기상 시각", "06", "00");
  await next(page);
  await page.getByLabel("공복 혈당", { exact: true }).fill("154");
  await next(page);
  await page.getByLabel("오늘 중강도 활동 시간", { exact: true }).fill("0");
  await next(page);
  for (let i = 0; i < 4; i++)
    await page.getByRole("button", { name: "이 항목 건너뛰기", exact: true }).click();
}

test("water is optional while the daily survey belongs to Main Quest", async ({ page }) => {
  await page.goto("/quests");
  await pause(page);
  const main = page.getByRole("tabpanel");
  await expect(main.getByRole("button", { name: /오늘의 건강 서베이/ })).toBeVisible();
  await expect(main.getByRole("button", { name: /물 마시기 실천|수면 7시간/ })).toHaveCount(0);
  await expect(main.getByRole("button", { name: /약 \/ 영양제 복용/ })).toBeVisible();
  await page.getByRole("tab", { name: "Sub Quest", exact: true }).click();
  await page.getByRole("button", { name: /물 마시기 실천/ }).click();
  await expect(page.getByRole("dialog")).toContainText("동작 한 번");
});

test("survey is one modal with separate steps, draft back navigation and cancel without saving", async ({
  page,
}) => {
  await page.goto("/quests");
  await pause(page);
  const trigger = page.getByRole("button", { name: /오늘의 건강 서베이/ });
  await trigger.click();
  await page.getByRole("button", { name: "서베이 작성", exact: true }).click();
  const modal = page.getByRole("dialog", { name: "오늘의 건강 서베이", exact: true });
  await expect(modal).toHaveCount(1);
  await expect(modal.getByRole("heading", { name: "혈압", exact: true })).toBeFocused();
  await expect(page.getByLabel("안정 시 맥박 측정 여부")).toHaveCount(0);
  await page
    .getByRole("radiogroup", { name: "오늘 혈압 측정 여부" })
    .getByRole("radio", { name: "측정했어요", exact: true })
    .check();
  await page.getByLabel("아침 수축기", { exact: true }).fill("148");
  await page.getByLabel("아침 이완기", { exact: true }).fill("94");
  await next(page);
  await expect(modal.getByRole("heading", { name: "안정 시 맥박", exact: true })).toBeFocused();
  await page.getByRole("button", { name: "이전", exact: true }).click();
  await expect(page.getByLabel("아침 수축기", { exact: true })).toHaveValue("148");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page).toHaveURL(/\/quests$/);
  await expect(trigger).toBeFocused();
  const saved = await page.evaluate(async () => {
    const path = "/src/stores/game-store.ts";
    const { useGameStore } = await import(path);
    const g = useGameStore.getState().game;
    return { survey: g.dailySurveys[g.date], completed: g.completed.includes("survey") };
  });
  expect(saved).toEqual({ survey: undefined, completed: false });
});

test("final review saves daily values once, allows corrections and reflects the dashboard", async ({
  page,
}) => {
  await page.goto("/daily-survey");
  await pause(page);
  await answers(page);
  await expect(page.getByRole("heading", { name: "입력 내용 확인", exact: true })).toBeVisible();
  await expect(page.locator(".daily-survey-review")).toContainText("0 분");
  await page.getByRole("button", { name: "오늘 서베이 제출", exact: true }).click();
  await expect(page.locator(".daily-survey").getByRole("status")).toContainText("메인 퀘스트 보상");
  const balances = () =>
    page.evaluate(async () => {
      const path = "/src/stores/game-store.ts";
      const { useGameStore } = await import(path);
      const g = useGameStore.getState().game;
      return { experience: g.experience, gold: g.gold };
    });
  const before = await balances();
  await page.getByRole("button", { name: "입력값 수정", exact: true }).click();
  await page.getByLabel("저녁 수축기", { exact: true }).fill("142");
  await page.getByLabel("저녁 이완기", { exact: true }).fill("90");
  for (let i = 0; i < 9; i++) await next(page);
  await page.getByRole("button", { name: "오늘 기록 수정", exact: true }).click();
  expect(await balances()).toEqual(before);
  await page.reload();
  await pause(page);
  await expect(page.getByLabel("저녁 수축기", { exact: true })).toHaveValue("142");
  for (let i = 0; i < 9; i++) await next(page);
  await page.getByRole("button", { name: "오늘 기록 수정", exact: true }).click();
  await page.getByRole("link", { name: "대시보드에서 오늘 기록 보기 ›", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const summary = page.getByRole("region", { name: "혈압 요약", exact: true });
  await expect(summary).toContainText("142 / 90");
  await expect(summary).toContainText("78");
});

test("each step rejects invalid values, preserves missing values and skips optional answers", async ({
  page,
}) => {
  await page.goto("/daily-survey");
  await pause(page);
  await next(page);
  await expect(page.getByRole("alert")).toBeVisible();
  await page
    .getByRole("radiogroup", { name: "오늘 혈압 측정 여부" })
    .getByRole("radio", { name: "측정했어요", exact: true })
    .check();
  await next(page);
  await expect(page.getByRole("heading", { name: "혈압", exact: true })).toBeVisible();
  await page.getByLabel("아침 수축기", { exact: true }).fill("148");
  await next(page);
  await expect(page.getByRole("alert")).toBeVisible();
  await page
    .getByRole("radiogroup", { name: "오늘 혈압 측정 여부" })
    .getByRole("radio", { name: "측정하지 못했어요", exact: true })
    .check();
  await next(page);
  await page
    .getByRole("radiogroup", { name: "안정 시 맥박 측정 여부" })
    .getByRole("radio", { name: "측정했어요", exact: true })
    .check();
  await next(page);
  await expect(page.getByRole("alert")).toBeVisible();
  await page
    .getByRole("radiogroup", { name: "안정 시 맥박 측정 여부" })
    .getByRole("radio", { name: "측정하지 못했어요", exact: true })
    .check();
  await next(page);
  await page
    .getByRole("radiogroup", { name: "어젯밤 수면 시간 확인 여부" })
    .getByRole("radio", { name: "모르겠어요", exact: true })
    .check();
  await next(page);
  await page.getByLabel("공복 혈당", { exact: true }).fill("-1");
  await next(page);
  await expect(page.getByRole("alert")).toBeVisible();
  await optionalToReview(page);
  await page.getByRole("button", { name: "오늘 서베이 제출", exact: true }).click();
  await expect(page.locator(".daily-survey").getByRole("status")).toContainText("제출했어요");
  const row = await page.evaluate(async () => {
    const path = "/src/stores/game-store.ts";
    const { useGameStore } = await import(path);
    const g = useGameStore.getState().game;
    return g.healthHistory[g.date];
  });
  expect(row).toMatchObject({
    systolic: null,
    diastolic: null,
    restingHr: null,
    glucose: null,
    sleepHours: null,
  });
});

test("dashboard retains its filter and scroll position when its survey modal closes", async ({
  page,
}) => {
  await page.goto("/dashboard?period=week");
  await pause(page);
  const trigger = page.getByRole("link", { name: "오늘 건강 서베이", exact: true });
  await trigger.scrollIntoViewIfNeeded();
  const before = await page.evaluate(() => scrollY);
  await trigger.click();
  await expect(page.getByRole("dialog", { name: "오늘의 건강 서베이", exact: true })).toBeVisible();
  await page.goBack();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page).toHaveURL(/\/dashboard\?period=week$/);
  await expect(trigger).toBeFocused();
  expect(Math.abs((await page.evaluate(() => scrollY)) - before)).toBeLessThan(3);
});

test("modal steps and actions fit narrow and short phone viewports", async ({ page }) => {
  await page.goto("/daily-survey");
  for (const width of [320, 390, 430]) {
    await page.setViewportSize({ width, height: 668 });
    await page
      .getByRole("radiogroup", { name: "오늘 혈압 측정 여부" })
      .getByRole("radio", { name: "측정했어요", exact: true })
      .check();
    const bounds = await page.getByRole("dialog").boundingBox();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
    expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(668);
    const button = page.getByRole("button", { name: "다음", exact: true });
    await expect(button).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)).toBe(
      false,
    );
  }
});

test("sleep clocks, Likert endpoints, tooltip and numeric units keep their values", async ({
  page,
}) => {
  await page.goto("/daily-survey");
  await pause(page);
  await page.getByRole("button", { name: "혈압 설명", exact: true }).click();
  await expect(page.getByRole("tooltip")).toContainText("실제로 측정한 혈압");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("tooltip")).toHaveCount(0);
  await expect(page.getByRole("dialog", { name: "오늘의 건강 서베이", exact: true })).toBeVisible();
  await page
    .getByRole("radiogroup", { name: "오늘 혈압 측정 여부" })
    .getByRole("radio", { name: "측정했어요", exact: true })
    .check();
  const input = await page.getByLabel("아침 수축기", { exact: true }).boundingBox();
  const unit = await page
    .locator(".daily-survey-field")
    .filter({ has: page.getByLabel("아침 수축기", { exact: true }) })
    .locator(".survey-number-heading small")
    .boundingBox();
  expect(unit!.y).toBeLessThan(input!.y);
  expect(unit!.x + unit!.width).toBeLessThanOrEqual(input!.x + input!.width + 2);
  await page
    .getByRole("radiogroup", { name: "오늘 혈압 측정 여부" })
    .getByRole("radio", { name: "측정하지 못했어요", exact: true })
    .check();
  await next(page);
  await page
    .getByRole("radiogroup", { name: "안정 시 맥박 측정 여부" })
    .getByRole("radio", { name: "측정하지 못했어요", exact: true })
    .check();
  await next(page);
  await page
    .getByRole("radiogroup", { name: "어젯밤 수면 시간 확인 여부" })
    .getByRole("radio", { name: "시간을 확인했어요", exact: true })
    .check();
  await setTime(page, "취침 시각", "23", "30");
  await setTime(page, "기상 시각", "06", "30");
  await expect(page.locator(".sleep-duration-output")).toContainText("7시간");
  await next(page);
  for (let i = 0; i < 3; i++)
    await page.getByRole("button", { name: "이 항목 건너뛰기", exact: true }).click();
  await page.getByRole("slider", { name: "어젯밤 코골이 정도" }).press("Home");
  await next(page);
  await page.getByRole("slider", { name: "오늘 낮의 졸림 정도" }).press("End");
  await next(page);
  await page.getByRole("button", { name: "이 항목 건너뛰기", exact: true }).click();
  await page.getByRole("button", { name: "오늘 서베이 제출", exact: true }).click();
  await expect(page.locator(".daily-survey").getByRole("status")).toContainText("수면 보너스");
  const saved = await page.evaluate(async () => {
    const path = "/src/stores/game-store.ts";
    const { useGameStore } = await import(path);
    const g = useGameStore.getState().game;
    return g.dailySurveys[g.date];
  });
  expect(saved).toMatchObject({
    bedtime: "23:30",
    wakeTime: "06:30",
    sleepHours: 7,
    snoringScore: 0,
    snoring: false,
    daytimeSleepinessScore: 10,
    daytimeSleepiness: true,
  });
});
