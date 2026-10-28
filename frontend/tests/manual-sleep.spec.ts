import { expect, test } from "@playwright/test";

test("legacy sleep URL opens the daily survey and cancelling grants no reward", async ({
  page,
}) => {
  await page.goto("/quests/sleep");
  const modal = page.getByRole("dialog", { name: "오늘의 건강 서베이", exact: true });
  await expect(modal).toBeVisible();
  const before = await page.evaluate(() => {
    const game = JSON.parse(localStorage.getItem("rexrun-demo-game-v1")!);
    return { experience: game.experience, completed: game.completed, sleepHours: game.sleepHours };
  });
  await page.getByRole("button", { name: "서베이 닫기", exact: true }).click();
  await expect(modal).toHaveCount(0);
  expect(
    await page.evaluate(() => {
      const game = JSON.parse(localStorage.getItem("rexrun-demo-game-v1")!);
      return {
        experience: game.experience,
        completed: game.completed,
        sleepHours: game.sleepHours,
      };
    }),
  ).toEqual(before);
});

test("sleep is recorded by bedtime and wake time inside the survey on small phones", async ({
  page,
}) => {
  for (const width of [320, 390, 430]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto("/daily-survey");
    const modal = page.getByRole("dialog", { name: "오늘의 건강 서베이", exact: true });
    await modal.getByRole("button", { name: "다음", exact: true }).click();
    await modal.getByRole("button", { name: "다음", exact: true }).click();
    for (const name of ["취침 시각", "기상 시각"]) {
      await expect(modal.getByRole("button", { name, exact: true })).toBeVisible();
      const box = (await modal.getByRole("button", { name, exact: true }).boundingBox())!;
      expect(box.height).toBeGreaterThanOrEqual(44);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  }
});
