import { expect, test } from "@playwright/test";

test("all six dinosaurs use their Figma projectile, stay in place and damage on impact", async ({
  page,
}) => {
  await page.clock.install({ time: new Date("2026-09-30T00:00:00Z") });
  await page.clock.pauseAt(new Date("2026-09-30T00:01:00Z"));
  await page.goto("/home");
  await expect(page.getByRole("button", { name: "모험 일시정지" })).toBeVisible();
  for (let dinosaur = 0; dinosaur < 6; dinosaur++) {
    await page.evaluate(async (dinosaur) => {
      const path = "/src/stores/game-store.ts";
      const { useGameStore } = await import(path);
      const { game } = useGameStore.getState();
      useGameStore.setState({
        paused: false,
        game: {
          ...game,
          dinosaur,
          battlePaused: false,
          combat: {
            ...game.combat,
            clock: 10000,
            attackIn: 0,
            spawned: 1,
            spawnIn: 5000,
            lastAttack: null,
            transition: null,
            recovery: 0,
            projectiles: [],
            playerProjectiles: [],
            enemies: [
              {
                id: 42,
                art: 0,
                rank: "normal",
                ranged: true,
                distance: 7,
                hp: 1000,
                maxHp: 1000,
                ad: 0,
                attackIn: 5000,
                hitAt: -1000,
              },
            ],
          },
        },
      });
    }, dinosaur);
    await page.clock.runFor(200);
    const player = page.locator(".battle-dinosaur");
    await expect(player).toHaveAttribute("data-attack-mode", "ranged");
    await expect(page.locator(".enemy-hp")).toHaveAttribute("aria-valuenow", "1000");
    const names = ["Trex", "Tricera", "Raptor", "Stego", "Ptera", "Brachio"];
    const shot = page.locator(".player-projectile").first();
    await expect(shot.locator("canvas")).toHaveAttribute(
      "data-src",
      `/assets/battle/Dino${names[dinosaur]}Projectile.png`,
    );
    expect(await player.evaluate((node) => parseFloat((node as HTMLElement).style.left))).toBe(8);
    await page.getByRole("button", { name: "모험 일시정지" }).click();
    const frozen = await shot.getAttribute("style");
    await page.clock.runFor(300);
    await expect(shot).toHaveAttribute("style", frozen!);
    await page.getByRole("button", { name: "모험 재개" }).click();
    await page.evaluate(async () => {
      const path = "/src/stores/game-store.ts";
      const { useGameStore } = await import(path);
      useGameStore.setState((state: { game: { combat: object } }) => ({
        game: { ...state.game, combat: { ...state.game.combat, attackIn: 5000 } },
      }));
    });
    await page.clock.runFor(1000);
    await expect(page.locator(".enemy-hp")).toHaveAttribute("aria-valuenow", "980");
    await expect(page.locator(".player-projectile")).toHaveCount(0);
    expect(await player.evaluate((node) => parseFloat((node as HTMLElement).style.left))).toBe(8);
  }
});

test("debug panel opens above the toggle with monster stats and matching enlarged projectile boxes", async ({
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
        combat: {
          ...game.combat,
          enemies: [
            {
              id: 42,
              art: 0,
              rank: "normal",
              ranged: true,
              distance: 7,
              hp: 70,
              maxHp: 100,
              ad: 23,
              attackIn: 250,
              hitAt: -1000,
            },
          ],
          projectiles: [{ id: "test-shot", art: 0, origin: 7, distance: 5, damage: 13 }],
        },
      },
    });
  });
  await page.getByRole("button", { name: "전투 디버그 표시" }).click();
  const panel = page.getByRole("region", { name: "전투 디버그 설정" });
  await expect(panel).toContainText("HP 70/100 · AD 23 · RANGE 7.00u");
  await expect(panel).toContainText("공격 1.00s · 이동 1.2u/s · 쿨타임 250ms");
  for (const width of [320, 390, 542]) {
    await page.setViewportSize({ width, height: 844 });
    await expect
      .poll(async () => {
        const popup = (await panel.boundingBox())!;
        const toggle = (await page.locator(".battle-debug-toggle").boundingBox())!;
        return popup.y + popup.height - toggle.y;
      })
      .toBeLessThanOrEqual(-7);
    const popup = (await panel.boundingBox())!;
    expect(popup.y).toBeGreaterThanOrEqual(0);
    expect(popup.x).toBeGreaterThanOrEqual(8);
    expect(popup.x + popup.width).toBeLessThanOrEqual(width - 8);
    expect(popup.x + popup.width / 2).toBeCloseTo(width / 2, 1);
    const shot = page.locator('[data-projectile-id="test-shot"]');
    const box = JSON.parse((await shot.getAttribute("data-hitbox"))!);
    const debug = page.locator('[data-debug-projectile="test-shot"] rect');
    for (const [key, value] of Object.entries(box))
      await expect(debug).toHaveAttribute(key, String(value));
    const size = await shot.evaluate((node) => ({
      width: parseFloat((node as HTMLElement).style.width),
      height: parseFloat((node as HTMLElement).style.height),
    }));
    expect(size.width).toBeCloseTo(39.2);
    expect(size.height).toBeCloseTo(29.4);
  }
  await page.screenshot({ path: "test-results/debug-ranged.png" });
  await page.getByRole("button", { name: "디버그 레벨 업" }).click();
  await expect(panel).toContainText("Lv.2");
  await page.keyboard.press("Escape");
  await expect(panel).toHaveCount(0);
  await expect(page.locator(".battle-debug-overlay")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "전투 디버그 표시" })).toBeFocused();
});
