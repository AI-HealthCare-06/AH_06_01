import { expect, test, type Page } from "@playwright/test";
async function pause(page: Page) {
  await page.evaluate(async () => {
    const p = "/src/stores/game-store.ts";
    const { useGameStore } = await import(p);
    useGameStore.getState().suspendSession();
  });
}
async function snapshot(page: Page) {
  return page.evaluate(async () => {
    const p = "/src/stores/game-store.ts";
    const { useGameStore } = await import(p);
    return useGameStore.getState().game;
  });
}
async function onboard(page: Page) {
  await page.goto("/login");
  await page.getByRole("button", { name: "다음", exact: true }).click();
  await expect(page.locator(".profile-title-row")).toContainText("1 / 3");
  await page.screenshot({ path: "test-results/first-login-basic.png" });
  await page.getByRole("button", { name: "다음: 혈압 정보", exact: true }).click();
  await expect(page.getByRole("spinbutton", { name: "공복 혈당", exact: true })).toHaveCount(0);
  await page.screenshot({ path: "test-results/first-login-pressure.png" });
  await page.getByRole("checkbox", { name: "혈압 모름", exact: true }).uncheck();
  await page.getByLabel("혈압", { exact: true }).fill("148 / 94");
  await page.getByRole("button", { name: "다음: 확인하고 완료", exact: true }).click();
  await expect(page.locator(".survey-confirmation")).not.toContainText("선택한 질환");
  await page.getByRole("button", { name: "공룡 깨우기", exact: true }).click();
  await expect(page).toHaveURL(/\/dinosaur$/);
  await page.getByRole("link", { name: "모험 시작하기", exact: true }).click();
  await page.getByRole("link", { name: "첫 퀘스트 시작하기", exact: true }).click();
  await pause(page);
}
async function finish(page: Page) {
  for (const title of [
    "그 밖의 만성질환",
    "특수 이력 / 치료 상태",
    "복용 중인 약과 시간",
    "확인하고 완료",
  ])
    await page.getByRole("button", { name: "다음: " + title, exact: true }).click();
  await page.getByRole("button", { name: "퀘스트 기록 완료", exact: true }).click();
  await expect(page).toHaveURL(/\/quests$/);
  await pause(page);
}
test("first login asks only basic and blood pressure; both deferred quests pay once", async ({
  page,
}) => {
  await onboard(page);
  const p = await page.evaluate(async () => {
    const path = "/src/stores/profile-store.ts";
    return (await import(path)).useProfileStore.getState().profile;
  });
  expect(p.bloodPressure).toBe("148 / 94");
  expect(p.glucose).toBe(null);
  expect(p.smoking).toBe(null);
  expect(p.hypertensionFamily).toBe(null);
  await page.getByRole("link", { name: /첫 주 건강 기록 퀘스트/ }).click();
  const section = page.getByRole("region", { name: "첫 주 건강 기록 퀘스트", exact: true });
  await expect(section).toContainText("0 / 2");
  await section.screenshot({ path: "test-results/first-week-quests.png" });
  const before = await snapshot(page);
  await section.getByRole("link", { name: /지병 기록하기/ }).click();
  await expect(page.locator(".profile-title-row")).toContainText("1 / 5");
  await finish(page);
  const conditions = await snapshot(page);
  expect(conditions.profileQuests.completed.conditions.experience).toBe(200);
  expect(
    conditions.experience -
      before.experience -
      (conditions.combatExperienceToday - before.combatExperienceToday),
  ).toBe(200);
  await section.getByRole("link", { name: /생활습관 기록하기/ }).click();
  for (const title of ["음주 습관", "추가 분석 정보", "가족력", "확인하고 완료"])
    await page.getByRole("button", { name: "다음: " + title, exact: true }).click();
  await page.getByRole("button", { name: "퀘스트 기록 완료", exact: true }).click();
  await pause(page);
  const both = await snapshot(page);
  expect(both.profileQuests.completed.lifestyle.experience).toBe(200);
  await expect(section).toContainText("2 / 2");
  await page.reload();
  await pause(page);
  await section.getByRole("link", { name: /지병 기록하기/ }).click();
  const againBefore = await snapshot(page);
  await finish(page);
  const again = await snapshot(page);
  expect(again.profileQuests).toEqual(both.profileQuests);
  expect(
    again.experience -
      againBefore.experience -
      (again.combatExperienceToday - againBefore.combatExperienceToday),
  ).toBe(0);
});
test("late records remain editable but receive no EXP and never become daily completions", async ({
  page,
}) => {
  await onboard(page);
  await page.evaluate(async () => {
    const p = "/src/stores/game-store.ts";
    const { useGameStore } = await import(p);
    const g = useGameStore.getState().game;
    useGameStore.setState({
      game: { ...g, profileQuests: { startedAt: Date.now() - 7 * 86400000, completed: {} } },
    });
  });
  await page.goto("/quests");
  await page.getByRole("link", { name: /지병 기록하기/ }).click();
  await finish(page);
  const game = await snapshot(page);
  expect(game.profileQuests.completed.conditions.experience).toBe(0);
  expect(game.completed).toEqual([]);
});
test("profile sections and quest cards fit narrow screens and enlarged text", async ({ page }) => {
  await onboard(page);
  await page.goto("/quests");
  for (const width of [320, 390, 430]) {
    await page.setViewportSize({ width, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  }
  await page.getByRole("link", { name: /생활습관 기록하기/ }).click();
  await page.evaluate(() => document.documentElement.style.setProperty("--ui-text-scale", "1.3"));
  for (const title of ["음주 습관", "추가 분석 정보", "가족력", "확인하고 완료"]) {
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.getByRole("button", { name: "다음: " + title, exact: true }).click();
  }
});

test("editing a single detail cannot complete unvisited profile quest sections", async ({
  page,
}) => {
  await onboard(page);
  await page.goto("/profile?mode=edit&section=analysis");
  await page.getByRole("button", { name: "다음: 가족력", exact: true }).click();
  await page.getByRole("button", { name: "다음: 확인하고 완료", exact: true }).click();
  await page.getByRole("button", { name: "변경 저장하고 홈으로", exact: true }).click();
  await pause(page);
  expect((await snapshot(page)).profileQuests.completed).toEqual({});
});
