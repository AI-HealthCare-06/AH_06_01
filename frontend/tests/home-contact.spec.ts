import { expect, test } from "@playwright/test";

test("home background encloses both quest panels after scrolling and recovery uses padded seconds", async ({
  page,
}) => {
  await page.clock.install({ time: new Date("2026-09-30T00:00:00Z") });
  await page.clock.pauseAt(new Date("2026-09-30T00:01:00Z"));
  await page.goto("/home");
  await page.evaluate(async () => {
    const path = "/src/stores/game-store.ts";
    const { useGameStore } = await import(path);
    const { game } = useGameStore.getState();
    useGameStore.setState({
      paused: true,
      game: {
        ...game,
        battlePaused: true,
        combat: { ...game.combat, hp: 0, recovery: 5000, enemies: [] },
      },
    });
  });
  await expect(page.locator(".battle-recovery")).toHaveText("05초 후 재시작");
  for (const width of [320, 390, 542]) {
    await page.setViewportSize({ width, height: 694 });
    await page.locator(".main-content").evaluate((el) => {
      el.scrollTop = el.scrollHeight;
    });
    const shell = (await page.locator(".home-content > .dark-shell").boundingBox())!;
    for (const selector of [".radar-card", ".compact-quests"]) {
      const panel = (await page.locator(selector).boundingBox())!;
      expect(shell.x).toBeLessThan(panel.x);
      expect(shell.x + shell.width).toBeGreaterThan(panel.x + panel.width);
      expect(shell.y + shell.height - panel.y - panel.height).toBeGreaterThanOrEqual(10);
    }
  }
  await page.screenshot({ path: "test-results/home-background.png", fullPage: true });
  await page.getByRole("button", { name: "모험 재개" }).click();
  await page.clock.runFor(1000);
  await expect(page.locator(".battle-recovery")).toHaveText("04초 후 재시작");
});

test("ranged body stops at reach and its shot disappears on the character hitbox", async ({
  page,
}) => {
  await page.clock.install({ time: new Date("2026-09-30T00:00:00Z") });
  await page.clock.pauseAt(new Date("2026-09-30T00:01:00Z"));
  await page.goto("/home");
  await page.evaluate(async () => {
    const path = "/src/stores/game-store.ts";
    const { useGameStore } = await import(path);
    const { game } = useGameStore.getState();
    useGameStore.setState({
      game: {
        ...game,
        combat: {
          ...game.combat,
          spawned: 1,
          spawnIn: 5000,
          attackIn: 5000,
          enemies: [
            {
              id: 1,
              art: 0,
              rank: "normal",
              ranged: true,
              distance: 3.1,
              hp: 1000,
              maxHp: 1000,
              ad: 20,
              attackIn: 0,
              hitAt: -1000,
            },
          ],
        },
      },
    });
  });
  await page.clock.runFor(100);
  const enemy = page.locator(".battle-enemy");
  const resting = await enemy.getAttribute("data-hitbox");
  await expect(page.locator(".enemy-projectile")).toHaveCount(1);
  await page.clock.runFor(100);
  await expect(enemy).toHaveAttribute("data-hitbox", resting!);
  const bounds = await page.locator(".enemy-projectile").getAttribute("data-hitbox");
  const projectile = JSON.parse(bounds!);
  const player = JSON.parse((await page.locator(".battle-dinosaur").getAttribute("data-hitbox"))!);
  expect(projectile.x).toBeGreaterThan(player.x + player.width);
  await expect(page.getByRole("meter", { name: "공룡 체력", exact: true })).toHaveAttribute(
    "aria-valuenow",
    "50",
  );
  await page.clock.runFor(50);
  await expect(page.locator(".enemy-projectile")).toHaveCount(0);
  await expect(page.getByRole("meter", { name: "공룡 체력", exact: true })).toHaveAttribute(
    "aria-valuenow",
    "40",
  );
  await expect(enemy).toHaveAttribute("data-hitbox", resting!);
});
