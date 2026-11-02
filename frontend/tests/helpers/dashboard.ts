import { expect, type Page } from "@playwright/test";

export async function seedDashboardActivity(page: Page) {
  await page.clock.setFixedTime(new Date("2026-10-28T03:00:00Z"));
  await page.goto("/dashboard");
  await expect(page.locator(".summary-score")).toBeVisible();
  const seed = await page.evaluate(() => {
    const game = JSON.parse(localStorage.getItem("rexrun-demo-game-v1")!);
    return {
      ...game,
      date: "2026-10-28",
      battlePaused: true,
      sampleDay: false,
      completed: ["meal", "survey"],
      sleepHours: 3.5,
      steps: { date: "2026-10-28", count: 3000, source: "health-connect", syncedAt: Date.now() },
      healthHistory: { "2026-10-27": { steps: 6000, sleepHours: 7 } },
      dailySurveys: {},
      questHistory: { "2026-10-27": 4 },
      questHistoryDetails: {},
      completedDates: [],
    };
  });
  await page.addInitScript((seed) => {
    if (sessionStorage.getItem("dashboard-activity-seeded")) return;
    localStorage.setItem("rexrun-demo-game-v1", JSON.stringify(seed));
    sessionStorage.setItem("dashboard-activity-seeded", "true");
  }, seed);
  await page.reload();
}
