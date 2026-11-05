import { test, expect, type Page } from "@playwright/test";

// Ordinary local test state; no filming persona, recorded response, or live AI.
async function seedCoach(page: Page) {
  await page.evaluate(async () => {
    const [
      { useGameStore },
      { dailySurveySchema },
      { ruleCoachPlan, coachContext },
      { useProfileStore },
    ] = await Promise.all([
      import("/src/stores/game-store.ts"),
      import("/src/domain/daily-survey.ts"),
      import("/src/domain/exercise-coach.ts"),
      import("/src/stores/profile-store.ts"),
    ]);
    const game = useGameStore.getState().game;
    const survey = {
      motivation: "fun",
      context: "ott",
      minutes: 5,
      activity: "inactive",
      period: "evening",
      limits: [],
      clinicianCleared: true,
      alcoholDays: 0,
      binge: false,
      updatedAt: Date.now(),
    } as const;
    const next = {
      ...game,
      dailySurveys: {
        ...game.dailySurveys,
        [game.date]: dailySurveySchema.parse({
          date: game.date,
          submittedAt: Date.now(),
          bloodPressureStatus: "measured",
          morning: { systolic: 125, diastolic: 80 },
          evening: null,
          pulseStatus: "not-measured",
          restingHr: null,
          sleepStatus: "unknown",
          sleepHours: null,
          fastingGlucose: null,
          activeMinutes: null,
          sedentaryHours: null,
          snoring: null,
          daytimeSleepiness: null,
          nocturia: null,
        }),
      },
      exerciseCoach: { survey: { ...survey, limits: [] }, plan: null, completed: {} },
    };
    useGameStore.setState({ game: next });
    if (
      !useGameStore
        .getState()
        .saveCoachPlan(
          ruleCoachPlan(
            game.date,
            next.exerciseCoach.survey,
            coachContext(next, useProfileStore.getState().profile),
          ),
        )
    )
      throw new Error("Test plan was not saved");
  });
}

test("quest notification settings preview progress and require native permission", async ({
  page,
}) => {
  await page.goto("/quests");
  await page.getByRole("link", { name: "퀘스트 독려·진행도 알림 설정 ›" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("switch", { name: "퀘스트 독려 알림" })).toBeVisible();
  await expect(dialog.getByText("실천 후 3시간 30분마다 독려")).toBeVisible();
  await expect(dialog.getByText(/퀘스트를 완료하면 다시 3시간 30분/)).toBeVisible();
  await expect(dialog.getByLabel("퀘스트 알림 미리보기")).toContainText("/ 4 완료");
  await dialog.getByRole("switch", { name: "알림창 진행도" }).click();
  await expect(dialog).toContainText("Android 앱에서 켤 수 있어요");
  await expect(dialog.getByRole("switch", { name: "알림창 진행도" })).toHaveAttribute(
    "aria-checked",
    "false",
  );
});

test("exercise rewards do not duplicate, affect main quests, or exceed the daily cap", async ({
  page,
}) => {
  await page.goto("/quests?tab=sub");
  await seedCoach(page);
  const result = await page.evaluate(async () => {
    const { useGameStore } = await import("/src/stores/game-store.ts");
    const store = useGameStore.getState(),
      game = store.game,
      plan = game.exerciseCoach.plan!;
    const rewards = plan.items.map((i) => store.finishExercise(i.id));
    const duplicate = store.finishExercise(plan.items[0].id);
    store.saveCoachPlan({
      ...plan,
      items: [{ id: "easy-dance", reason: "Additional safe candidate" }],
    });
    const overCap = store.finishExercise("easy-dance");
    return {
      rewards,
      duplicate,
      overCap,
      gained: useGameStore.getState().game.experience - game.experience,
      main: useGameStore.getState().game.completed.join(","),
      originalMain: game.completed.join(","),
    };
  });
  expect(result.rewards).toEqual([60, 60, 60]);
  expect(result.duplicate).toBeNull();
  expect(result.overCap).toBeNull();
  expect(result.gained).toBe(180);
  expect(result.main).toBe(result.originalMain);
});

test("first survey is paged, grants its reward once, and offers gentle basic recommendations", async ({
  page,
}) => {
  await page.goto("/quests?tab=sub");
  await page.getByRole("button", { name: "첫 운동 취향 서베이 · +100 EXP ›", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("button", { name: "다음 항목" })).toBeDisabled();
  await dialog.getByLabel("재미와 보상이 있어야 해요").check();
  await dialog.getByLabel("드라마·동영상 보는 시간").check();
  await dialog.getByRole("button", { name: "다음 항목" }).click();
  await dialog.getByLabel("2분", { exact: true }).check();
  await dialog.getByLabel("운동을 거의 하지 않아요").check();
  await dialog.getByLabel("저녁", { exact: true }).check();
  await dialog.getByRole("button", { name: "다음 항목" }).click();
  await dialog.getByLabel("0일", { exact: true }).check();
  await dialog.getByLabel("아니요", { exact: true }).check();
  await dialog.getByRole("button", { name: "다음 항목" }).click();
  await dialog.getByRole("button", { name: "다음 항목" }).click();
  await dialog.getByRole("button", { name: "서베이 저장 · +100 EXP" }).click();
  await expect(dialog).toHaveCount(0);
  await page.getByRole("button", { name: "기본 추천 보기", exact: true }).click();
  await expect(page.locator(".coach-exercise-card")).toHaveCount(2);
  await expect(page.locator(".coach-plan")).toContainText("설문 기반 기본 추천");
  const experience = () =>
    page.evaluate(async () => {
      const { useGameStore } = await import("/src/stores/game-store.ts");
      const g = useGameStore.getState().game;
      return g.experience - g.combatExperienceToday;
    });
  expect(await experience()).toBe(100);
  await page.getByRole("button", { name: "운동 취향 수정 ›" }).click();
  for (let i = 0; i < 4; i++) await dialog.getByRole("button", { name: "다음 항목" }).click();
  await dialog.getByRole("button", { name: "서베이 저장", exact: true }).click();
  expect(await experience()).toBe(100);
});

test("exercise timer advances before self-confirmed completion unlocks", async ({ page }) => {
  await page.clock.install();
  await page.goto("/quests?tab=sub");
  await seedCoach(page);
  await page.locator(".coach-exercise-card").first().click();
  await page.getByRole("dialog").getByRole("checkbox").check();
  const complete = page.getByRole("button", { name: "직접 실천 완료 확인 · +60 EXP", exact: true });
  await expect(complete).toBeDisabled();
  await page.getByRole("button", { name: "실천 타이머 시작", exact: true }).click();
  await page.clock.runFor(1500);
  await expect(page.getByRole("timer")).not.toHaveText("5:00");
  await page.clock.fastForward(301000);
  await expect(page.getByRole("timer")).toHaveText("0:00");
  await expect(complete).toBeEnabled();
  await complete.click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.locator(".coach-exercise-card").first()).toContainText("오늘 완료");
});

test("sub quest deep links switch an already-open main quest tab", async ({ page }) => {
  await page.goto("/quests");
  await expect(page.getByRole("tab", { name: "Main Quest", exact: true })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await page.evaluate(() => {
    history.pushState({ key: "notification-deep-link" }, "", "/quests?tab=sub");
    dispatchEvent(new PopStateEvent("popstate"));
  });
  await expect(page.getByRole("tab", { name: "Sub Quest", exact: true })).toHaveAttribute(
    "aria-selected",
    "true",
  );
});

test("AI recommendations are opt-in and render bounded responses without live calls", async ({
  page,
}) => {
  let calls = 0;
  await page.route("**/api/diet/exercise/recommend", async (route) => {
    calls++;
    const body = route.request().postDataJSON();
    expect(body.ai_consent).toBe(true);
    await route.fulfill({
      json: {
        date: body.date,
        source: "ai",
        model: "test-double",
        summary: "작은 움직임부터 시작해요.",
        items: [{ id: "ott-walk", reason: "가능한 시간 안에서 가볍게 움직여요." }],
      },
    });
  });
  await page.goto("/quests?tab=sub");
  await seedCoach(page);
  const recommend = page.getByRole("button", { name: "AI 맞춤 추천 받기", exact: true });
  await expect(recommend).toBeDisabled();
  expect(calls).toBe(0);
  await page
    .locator(".exercise-coach")
    .getByRole("checkbox", { name: /취향·운동\/음주 습관/ })
    .check();
  await recommend.click();
  await expect(page.locator(".coach-plan")).toContainText("AI 선택 · test-double");
  await expect(page.locator(".coach-exercise-card")).toHaveCount(1);
  expect(calls).toBe(1);
});
