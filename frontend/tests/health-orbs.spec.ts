import { expect, test } from "@playwright/test";

test("owner death removes flying/contact shots and their debug boxes before they can damage", async ({
  page,
}) => {
  await page.clock.install({ time: new Date("2026-10-28T03:00:00Z") });
  await page.clock.pauseAt(new Date("2026-10-28T03:01:00Z"));
  await page.goto("/home");
  await page.evaluate(async () => {
    const storePath = "/src/stores/game-store.ts";
    const battlePath = "/src/domain/battle.ts";
    const { useGameStore } = await import(storePath);
    const { initialCombat } = await import(battlePath);
    const { game } = useGameStore.getState();
    const enemy = {
      id: 1,
      art: 0,
      rank: "normal",
      hp: 1,
      maxHp: 70,
      ad: 0,
      distance: 7,
      attackIn: 5000,
      ranged: true,
      hitAt: -1000,
    };
    useGameStore.setState({
      paused: true,
      game: {
        ...game,
        dinosaur: 0,
        experience: 0,
        battlePaused: true,
        battleUpdatedAt: Date.now(),
        combat: {
          ...initialCombat(),
          spawned: 2,
          spawnIn: 5000,
          attackIn: 5000,
          enemies: [enemy, { ...enemy, id: 2, hp: 1000, distance: 7.5 }],
          lastAttack: {
            time: 0,
            impactAt: 50,
            resolved: false,
            targetId: 1,
            distance: 7,
            damage: 20,
            critical: false,
          },
          projectiles: [
            { id: "contact", ownerId: 1, art: 0, origin: 7, distance: 0.5, damage: 100 },
            { id: "flight", ownerId: 1, art: 0, origin: 7, distance: 6, damage: 100 },
            { id: "other", ownerId: 2, art: 0, origin: 7, distance: 6, damage: 10 },
          ],
        },
      },
    });
  });
  await page.getByRole("button", { name: "전투 디버그 표시" }).click();
  await expect(page.locator(".enemy-projectile")).toHaveCount(3);
  await expect(page.locator("[data-debug-projectile]")).toHaveCount(3);
  await page.getByRole("button", { name: "모험 재개", exact: true }).click();
  await page.clock.runFor(50);
  await expect(page.locator(".enemy-projectile")).toHaveCount(1);
  await expect(page.locator('.enemy-projectile[data-projectile-id="other"]')).toHaveCount(1);
  await expect(page.locator("[data-debug-projectile]")).toHaveCount(1);
  await expect(page.getByRole("meter", { name: "공룡 체력", exact: true })).toHaveAttribute(
    "aria-valuenow",
    "50",
  );
  await expect(page.locator(".battle-recovery")).toHaveCount(0);
});

test("four drop tiers heal immediately, absorb toward the dinosaur and survive pause/reload once", async ({
  page,
}) => {
  await page.clock.install({ time: new Date("2026-10-28T03:00:00Z") });
  await page.clock.pauseAt(new Date("2026-10-28T03:01:00Z"));
  await page.goto("/home");
  test.setTimeout(90_000);
  for (const [seed, fraction, healed] of [
    [1972, 0.1, 4],
    [1976, 0.2, 8],
    [1980, 0.4, 16],
    [1981, 1, 40],
  ]) {
    await page.evaluate(async (seed) => {
      const storePath = "/src/stores/game-store.ts";
      const battlePath = "/src/domain/battle.ts";
      const { useGameStore } = await import(storePath);
      const { initialCombat } = await import(battlePath);
      const { game } = useGameStore.getState();
      useGameStore.setState({
        paused: false,
        game: {
          ...game,
          dinosaur: 0,
          experience: 0,
          battlePaused: false,
          battleUpdatedAt: Date.now(),
          combat: {
            ...initialCombat(10),
            seed,
            spawned: 1,
            spawnIn: 5000,
            attackIn: 5000,
            enemies: [
              {
                id: 1,
                art: 0,
                rank: "normal",
                hp: 1,
                maxHp: 70,
                ad: 0,
                distance: 7,
                attackIn: 5000,
                ranged: true,
                hitAt: -1000,
              },
            ],
            lastAttack: {
              time: 0,
              impactAt: 50,
              resolved: false,
              targetId: 1,
              distance: 7,
              damage: 20,
              critical: false,
            },
          },
        },
      });
    }, seed);
    await page.clock.runFor(50);
    const orb = page.locator(".battle-health-orb");
    await expect(orb).toHaveCount(1);
    await expect(orb).toHaveAttribute("data-heal-fraction", String(fraction));
    await expect(orb).toHaveAttribute("data-healed", String(healed));
    await expect(orb).toHaveAccessibleName(
      `체력 구슬 · 잃은 체력의 ${fraction * 100}% 회복 · +${healed} HP`,
    );
    const hp = page.getByRole("meter", { name: "공룡 체력", exact: true });
    await expect(hp).toHaveAttribute("aria-valuenow", String(10 + healed));
    const icon = orb.locator("svg");
    const start = (await icon.boundingBox())!;
    await page.clock.runFor(200);
    const absorbed = (await icon.boundingBox())!;
    expect(absorbed.x).toBeLessThan(start.x - 50);
    await page.getByRole("button", { name: "모험 일시정지", exact: true }).click();
    await page.clock.runFor(1000);
    expect(await icon.boundingBox()).toEqual(absorbed);
    await page.reload();
    await expect(orb).toHaveCount(1);
    await expect(hp).toHaveAttribute("aria-valuenow", String(10 + healed));
    expect(await icon.boundingBox()).toEqual(absorbed);
    if (fraction === 1) await page.screenshot({ path: "test-results/health-orb-absorption.png" });
    await page.getByRole("button", { name: "모험 재개", exact: true }).click();
    await page.clock.runFor(750);
    await expect(orb).toHaveCount(0);
    await expect(hp).toHaveAttribute("aria-valuenow", String(10 + healed));
  }
});

test("reduced motion shows healing feedback at the dinosaur without flight", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.clock.install({ time: new Date("2026-10-28T03:00:00Z") });
  await page.clock.pauseAt(new Date("2026-10-28T03:01:00Z"));
  await page.goto("/home");
  await page.evaluate(async () => {
    const storePath = "/src/stores/game-store.ts";
    const { useGameStore } = await import(storePath);
    const { game } = useGameStore.getState();
    useGameStore.setState({
      paused: true,
      game: {
        ...game,
        battlePaused: true,
        combat: {
          ...game.combat,
          clock: 100,
          healthOrbs: [{ id: "heal", time: 100, x: 280, y: 220, fraction: 0.1, healed: 4 }],
        },
      },
    });
  });
  const orb = page.locator(".battle-health-orb");
  await expect(orb).toContainText("+4 HP");
  const icon = (await orb.locator("svg").boundingBox())!;
  const dinosaur = (await page.locator(".battle-dinosaur").boundingBox())!;
  expect(icon.x).toBeGreaterThan(dinosaur.x);
  expect(icon.x + icon.width).toBeLessThan(dinosaur.x + dinosaur.width);
  await page.screenshot({ path: "test-results/health-orb-reduced-motion.png" });
});
