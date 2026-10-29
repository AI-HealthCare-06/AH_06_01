import { expect, test } from "@playwright/test";
import monthlyAnalysis from "./fixtures/office-month-analysis.json" with { type: "json" };
import { expectNoHorizontalOverflow } from "./helpers/layout";

test("office month demo keeps source facts, thirty surveys and balances isolated from both existing saves", async ({
  page,
}, testInfo) => {
  await page.clock.setFixedTime(new Date("2026-10-29T03:00:00Z"));
  await page.addInitScript(() => {
    localStorage.setItem("rexrun-persona-mode", "true");
    localStorage.setItem("rexrun-persona-id", "office-month-v1");
    localStorage.setItem("rexrun-demo-game-v1", "real-account-preserved");
    localStorage.setItem("rexrun-persona:rexrun-demo-game-v1", "legacy-demo-preserved");
  });
  await page.route("**/predictions/bp-stage", async (route) => {
    expect(route.request().postDataJSON()).toEqual({ demo_persona: "office-month-v1" });
    await route.fulfill({ json: monthlyAnalysis });
  });
  await page.goto("/dashboard?period=custom&from=2026-09-30&date=2026-10-29");
  await expect(
    page.getByText("DEMO · 42세 사무직 A / 합성 30일 기록", { exact: true }),
  ).toBeVisible();
  await expect(page.locator(".health-history-overview")).toContainText("합성 30일 기록");
  await expect(page.locator(".score-number")).toHaveText("82");
  await page.screenshot({
    path: testInfo.outputPath("office-month-dashboard.png"),
    fullPage: true,
  });
  await page.goto("/dashboard?period=day&date=2026-09-30");
  await expect(page.locator(".score-number")).toHaveText("62");
  const state = await page.evaluate(() => {
    const game = JSON.parse(
      localStorage.getItem("rexrun-persona:office-month:rexrun-demo-game-v1")!,
    );
    return {
      dates: Object.keys(game.dailySurveys),
      sleepDays: Object.keys(game.sleepExperience).length,
      profileQuests: game.profileQuests,
      experience: game.experience,
      gold: game.gold,
      completed: game.completed,
      old: localStorage.getItem("rexrun-demo-game-v1"),
      legacy: localStorage.getItem("rexrun-persona:rexrun-demo-game-v1"),
    };
  });
  expect(state.dates).toHaveLength(30);
  expect(state.dates[0]).toBe("2026-09-30");
  expect(state.sleepDays).toBe(30);
  expect(state.profileQuests.completed.conditions.experience).toBe(200);
  expect(state.profileQuests.completed.lifestyle.experience).toBe(200);
  expect(state.completed).not.toContain("medicine");
  expect(state.old).toBe("real-account-preserved");
  expect(state.legacy).toBe("legacy-demo-preserved");
  for (const width of [320, 390, 534]) {
    await page.setViewportSize({ width, height: 844 });
    await expectNoHorizontalOverflow(page);
  }
  await page.goto("/medications");
  await expect(page.getByText("인슐린", { exact: true })).toHaveCount(0);
  await page.reload();
  const later = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("rexrun-persona:office-month:rexrun-demo-game-v1")!),
  );
  expect(later.experience).toBe(state.experience);
  expect(later.gold).toBe(state.gold);
  await page.goto("/quests");
  await page.getByRole("tab", { name: "Sub Quest", exact: true }).click();
  await expect(page.getByRole("button", { name: /물 마시기 실천/ })).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("office-month-subquests.png"),
    fullPage: true,
  });
});
