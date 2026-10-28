import { expect, test } from "@playwright/test";

test("dashboard rings and metric switches show saved activity without granting quest rewards", async ({
  page,
}) => {
  await page.clock.setFixedTime(new Date("2026-10-22T03:00:00Z"));
  await page.goto("/dashboard");
  await expect(page.locator(".summary-score")).toBeVisible();
  const seed = await page.evaluate(() => {
    const game = JSON.parse(localStorage.getItem("rexrun-demo-game-v1")!);
    return {
      ...game,
      battlePaused: true,
      sampleDay: false,
      completed: ["meal"],
      questHistory: { "2026-10-21": 3 },
      sleepHours: 6.5,
      steps: { date: "2026-10-22", count: 3240, source: "health-connect", syncedAt: Date.now() },
    };
  });
  await page.addInitScript((seed) => {
    if (sessionStorage.getItem("dashboard-layout-seeded")) return;
    localStorage.setItem("rexrun-demo-game-v1", JSON.stringify(seed));
    sessionStorage.setItem("dashboard-layout-seeded", "true");
  }, seed);
  await page.reload();
  await expect(
    page.getByRole("img", { name: /걸음 활동 3,240보, 퀘스트 1 \/ 4, 수면 6.5시간/ }),
  ).toBeVisible();
  const panel = page.getByRole("region", { name: "선택한 지표", exact: true });
  await page.getByRole("button", { name: "걸음 수", exact: true }).click();
  await expect(panel.locator(".stitch-metric-value strong")).toHaveText("3,240보");
  await expect(panel.getByRole("img")).toHaveAttribute(
    "aria-label",
    /2026-10-21 기록 없음, 2026-10-22 3240보/,
  );
  await page.getByRole("button", { name: "수면 시간", exact: true }).click();
  await expect(panel.locator(".stitch-metric-value strong")).toHaveText("6.5시간");
  await page.getByRole("button", { name: "퀘스트", exact: true }).click();
  await expect(panel.locator(".stitch-metric-value strong")).toHaveText("4개");
  await page.getByRole("button", { name: "건강 점수", exact: true }).click();
  await expect(panel.getByText("실제 건강 기록이 연결되면 내 변화량을 보여드려요.")).toBeVisible();
  const before = await page.evaluate(() => {
    const game = JSON.parse(localStorage.getItem("rexrun-demo-game-v1")!);
    return { completed: game.completed, gold: game.gold, experience: game.experience };
  });
  await page.getByRole("link", { name: "퀘스트", exact: true }).click();
  await page.getByRole("tab", { name: "Sub Quest", exact: true }).click();
  await page.getByRole("button", { name: /물 마시기 실천/ }).click();
  await page.getByRole("link", { name: "진행·보상 자세히 보기" }).click();
  await expect(page).toHaveURL(/\/quests\/water$/);
  expect(
    await page.evaluate(() => {
      const game = JSON.parse(localStorage.getItem("rexrun-demo-game-v1")!);
      return { completed: game.completed, gold: game.gold, experience: game.experience };
    }),
  ).toEqual(before);
});

test("historical dashboard does not invent per-quest details or missing step and sleep history", async ({
  page,
}) => {
  await page.goto("/dashboard?period=month&date=2026-10-10");
  await expect(
    page.getByRole("img", { name: /걸음 활동 기록 없음, 퀘스트 0 \/ 4, 수면 기록 없음/ }),
  ).toBeVisible();
  await expect(page.locator(".stitch-quest-row")).toHaveCount(0);
  for (const metric of ["걸음 수", "수면 시간"]) {
    await page.getByRole("button", { name: metric, exact: true }).click();
    const panel = page.getByRole("region", { name: "선택한 지표", exact: true });
    await expect(panel.locator(".stitch-metric-value strong")).toContainText("—");
    await expect(panel.locator(".stitch-telemetry-column[data-missing=true]")).toHaveCount(7);
  }
});
