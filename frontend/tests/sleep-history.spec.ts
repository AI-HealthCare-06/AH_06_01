import { test, expect } from "@playwright/test";
test("short sleep grants its measured bonus once without a standalone sleep quest", async ({
  page,
}) => {
  await page.goto("/home");
  const record = await page.evaluate(async () => {
    const path = "/src/stores/game-store.ts";
    const { useGameStore } = await import(path);
    useGameStore.getState().suspendSession();
    const before = useGameStore.getState().game.experience;
    const date = useGameStore.getState().game.date;
    useGameStore.getState().recordSleep(330, date);
    const game = useGameStore.getState().game;
    useGameStore.getState().recordSleep(330, date);
    const afterRepeat = useGameStore.getState().game.experience;
    return {
      hours: game.sleepHours,
      saved: game.healthHistory[date].sleepHours,
      sleepCompleted: game.completed.includes("sleep"),
      reward: game.experience - before,
      duplicateReward: afterRepeat - game.experience,
    };
  });
  expect(record).toEqual({
    hours: 5.5,
    saved: 5.5,
    sleepCompleted: false,
    reward: 110,
    duplicateReward: 0,
  });
  await page.reload();
  expect(
    await page.evaluate(() => JSON.parse(localStorage.getItem("rexrun-demo-game-v1")!).sleepHours),
  ).toBe(5.5);
});
