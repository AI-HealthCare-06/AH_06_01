import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
const fixture = JSON.parse(
  readFileSync(new URL("./fixtures/quest-analysis-demo.json", import.meta.url), "utf8"),
);
const live = process.env.REXRUN_DEMO_LIVE_MODEL === "1";
test.use({ timezoneId: "Asia/Seoul" });

async function state(page: Page) {
  return page.evaluate(async () => {
    const path = "/src/stores/game-store.ts";
    const { useGameStore } = await import(path);
    useGameStore.getState().suspendSession();
    return useGameStore.getState().game;
  });
}

test("demo week connects survey data, actual rewards, dashboard analysis and current Sub Quest routes", async ({
  page,
}) => {
  test.setTimeout(90_000);
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(new Date());
  let privateCalls = 0;
  let modelCalls = 0;
  await page.addInitScript(() => {
    localStorage.setItem("rexrun-persona-mode", "true");
    localStorage.setItem("rexrun-demo-game-v1", "real-account-cache-preserved");
  });
  await page.route("**/v1/sync", async (route) => {
    privateCalls++;
    await route.abort();
  });
  await page.route("**/predictions/bp-stage", async (route) => {
    modelCalls++;
    expect(route.request().postDataJSON()).toEqual({ demo_persona: "htn-diabetes-v1" });
    expect(route.request().headers().authorization).toBeUndefined();
    if (live) {
      const response = await route.fetch({ url: "http://127.0.0.1:8007/predictions/bp-stage" });
      expect(response.status()).toBe(200);
      const body = await response.json();
      expect(body.daily_survey_date).toBe(today);
      expect(body.m1.data_quality).toBe("not_applicable");
      expect(body.m2.states.NOCTURNAL_SCREEN.status).toBe("positive");
      await route.fulfill({ response });
    } else {
      const previous = new Date(today + "T12:00:00+09:00");
      previous.setDate(previous.getDate() - 1);
      await route.fulfill({
        json: {
          ...fixture,
          as_of: today,
          daily_survey_date: today,
          previous_day: {
            ...fixture.previous_day,
            date: new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(previous),
            completed_quests: ["meal", "water", "survey"],
          },
        },
      });
    }
  });
  await page.goto("/dashboard");
  const first = await state(page);
  expect(Object.keys(first.dailySurveys)).toHaveLength(7);
  expect(Object.keys(first.sleepExperience)).toHaveLength(7);
  expect(first.dailySurveys[today]).toMatchObject({
    bedtime: "23:48",
    wakeTime: "06:00",
    sleepHours: 6.2,
    snoringScore: 6,
    daytimeSleepinessScore: 5,
  });
  const reward = first.sleepExperience[today].experience;
  const analysis = page.getByRole("region", { name: "M1·M2 참고 분석" });
  await expect(analysis).toContainText(`일일 서베이 ${today} 반영`, { timeout: 30_000 });
  await expect(analysis).toContainText("확인 항목 1 / 10");
  await expect(page.getByRole("region", { name: "혈압 요약" })).toContainText("148 / 94");
  await expect(page.locator('[aria-label="선택일 수면 추가 EXP"]')).toContainText(`+${reward} EXP`);
  const chart = page.getByRole("region", { name: "저장된 건강 기록 추이" });
  await expect(chart).toContainText("합성 7일 기록");
  expect(await chart.locator("svg title").first().textContent()).toContain(
    Object.keys(first.dailySurveys)[0],
  );
  await page.goto("/quests");
  await state(page);
  await expect(page.getByRole("progressbar", { name: "오늘의 퀘스트 달성률" })).toHaveAttribute(
    "aria-valuenow",
    "2",
  );
  await expect(page.locator('[aria-label="오늘 수면 추가 EXP"]')).toContainText(`+${reward} EXP`);
  await page.getByRole("tab", { name: "Sub Quest", exact: true }).click();
  const sub = page.getByRole("tabpanel");
  await expect(sub.getByRole("button", { name: /약 \/ 영양제 복용/ })).toBeVisible();
  await expect(sub.getByRole("button", { name: /6,000걸음 걷기/ })).toBeVisible();
  await expect(sub.getByRole("button", { name: /수면 7시간/ })).toHaveCount(0);
  await sub.getByRole("button", { name: /오늘의 건강 서베이/ }).click();
  await page.getByRole("button", { name: "서베이 작성", exact: true }).click();
  await expect(page.getByLabel("아침 수축기", { exact: true })).toHaveValue("148");
  for (let i = 0; i < 9; i++) await page.getByRole("button", { name: "다음", exact: true }).click();
  await expect(page.getByRole("heading", { name: "입력 내용 확인", exact: true })).toBeVisible();
  const before = await state(page);
  await page.getByRole("button", { name: "오늘 기록 수정", exact: true }).click();
  await expect(page.locator(".daily-survey").getByRole("status")).toContainText(
    "메인 퀘스트 보상은 중복 지급하지 않아요",
  );
  const after = await state(page);
  expect(after.experience).toBe(before.experience);
  expect(after.gold).toBe(before.gold);
  expect(after.sleepExperience).toEqual(before.sleepExperience);
  await page.reload();
  const reloaded = await state(page);
  expect(reloaded.experience).toBe(after.experience);
  expect(reloaded.sleepExperience).toEqual(after.sleepExperience);
  expect(await page.evaluate(() => localStorage.getItem("rexrun-demo-game-v1"))).toBe(
    "real-account-cache-preserved",
  );
  expect(privateCalls).toBe(0);
  expect(modelCalls).toBeGreaterThan(0);
});
