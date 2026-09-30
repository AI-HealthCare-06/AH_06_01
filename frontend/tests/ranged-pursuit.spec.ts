import { expect, test } from "@playwright/test";

test("all six dinosaurs extend the strike to a distant ranged target and hit on contact", async ({
  page,
}) => {
  await page.clock.install({ time: new Date("2026-09-30T00:00:00Z") });
  await page.clock.pauseAt(new Date("2026-09-30T00:01:00Z"));
  await page.goto("/home");
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
    await page.clock.runFor(50);
    const player = page.locator(".battle-dinosaur");
    await expect(player).toHaveAttribute("data-attacking", "true");
    await expect(page.locator(".enemy-hp")).toHaveAttribute("aria-valuenow", "1000");
    await page.clock.runFor(400);
    await expect(page.locator(".enemy-hp")).toHaveAttribute("aria-valuenow", "980");
    const left = await player.evaluate((node) => parseFloat((node as HTMLElement).style.left));
    expect(left).toBeGreaterThan(170);
    const frozenHitbox = JSON.parse((await player.getAttribute("data-hitbox"))!);
    expect(frozenHitbox.x).toBeLessThan(40);
    await page.clock.runFor(300);
    await expect(player).toHaveAttribute("data-attacking", "true");
    await expect(page.locator(".enemy-hp")).toHaveAttribute("aria-valuenow", "980");
    await page.clock.runFor(500);
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
