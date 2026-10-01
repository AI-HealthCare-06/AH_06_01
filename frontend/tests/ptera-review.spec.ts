import { expect, test } from "@playwright/test";

test("Ptera fires toward its target, rotates the artwork, and grows the visible debug hitbox", async ({
  page,
}) => {
  await page.clock.install();
  await page.clock.pauseAt(new Date());
  await page.goto("/home");
  await page.evaluate(async () => {
    const path = "/src/stores/game-store.ts";
    const { useGameStore } = await import(path);
    const { game } = useGameStore.getState();
    useGameStore.setState({
      paused: false,
      game: {
        ...game,
        dinosaur: 4,
        battlePaused: false,
        combat: {
          ...game.combat,
          clock: 0,
          hp: 50,
          spawned: 1,
          spawnIn: 5000,
          attackIn: 0,
          recovery: 0,
          transition: null,
          lastAttack: null,
          projectiles: [],
          playerProjectiles: [],
          enemies: [
            {
              id: 42,
              art: 1,
              ranged: true,
              rank: "normal",
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
  });
  await page.clock.runFor(200);
  await expect(page.locator(".player-projectile")).toHaveCount(1);
  const flight = await page.evaluate(async () => {
    const path = "/src/stores/game-store.ts";
    const { useGameStore } = await import(path);
    const { game } = useGameStore.getState();
    const shot = game.combat.playerProjectiles[0],
      aim = game.combat.lastAttack;
    useGameStore.setState({
      paused: true,
      game: {
        ...game,
        battlePaused: true,
        combat: { ...game.combat, clock: 0, lastAttack: null, attackIn: 5000 },
      },
    });
    return { shot, aim };
  });
  expect(flight.shot.vx).toBeGreaterThan(0);
  expect(flight.shot.vy).toBeGreaterThan(0);
  expect(flight.shot.vy / flight.shot.vx).toBeCloseTo(
    (flight.aim!.aimY! - flight.shot.y) / (flight.aim!.aimX! - flight.shot.x),
    5,
  );
  await page.getByRole("button", { name: "전투 디버그 표시" }).click();
  for (const width of [320, 390, 534]) {
    await page.setViewportSize({ width, height: 844 });
    let base: { width: number; height: number };
    for (const age of [0, 80, 160, 240, 320, 640]) {
      await page.evaluate(async (age) => {
        const path = "/src/stores/game-store.ts";
        const { useGameStore } = await import(path);
        useGameStore.setState(
          ({ game }: { game: { combat: { playerProjectiles: object[] } } }) => ({
            game: {
              ...game,
              combat: {
                ...game.combat,
                playerProjectiles: game.combat.playerProjectiles.map((shot) => ({ ...shot, age })),
              },
            },
          }),
        );
      }, age);
      const shot = page.locator(".player-projectile"),
        box = JSON.parse((await shot.getAttribute("data-hitbox"))!);
      if (age === 0) base = box;
      if (age === 320 || age === 640) {
        expect(box.width).toBeGreaterThan(base!.width);
        expect(box.height).toBeGreaterThan(base!.height);
      }
      const debug = page.locator(`[data-debug-projectile="${flight.shot.id}"]`);
      await expect(debug.locator("text")).toHaveText("P1 HIT");
      for (const [key, value] of Object.entries(box))
        await expect(debug.locator("rect")).toHaveAttribute(key, String(value));
      await expect
        .poll(() =>
          shot.evaluate((node) => {
            const hit = JSON.parse(node.getAttribute("data-hitbox")!);
            const arena = node.closest(".design-canvas-inner")!.getBoundingClientRect(),
              scale = arena.width / 354;
            const canvas = node.querySelector("canvas")!.getBoundingClientRect();
            return Math.max(
              Math.abs(canvas.x - arena.x - hit.x * scale),
              Math.abs(canvas.y - arena.y - hit.y * scale),
              Math.abs(canvas.width - hit.width * scale),
              Math.abs(canvas.height - hit.height * scale),
            );
          }),
        )
        .toBeLessThan(0.2);
    }
    const height = await page.locator(".battle-dinosaur canvas").evaluate((node) => {
      const arena = node.closest(".design-canvas-inner")!.getBoundingClientRect(),
        scale = arena.width / 354;
      const sprite = node.getBoundingClientRect();
      return (sprite.y + sprite.height / 2 - arena.y) / scale;
    });
    expect(height).toBeCloseTo(188.8, 1);
  }
  await page
    .locator(".pixel-battle")
    .screenshot({ path: "test-results/ptera-diagonal-hitbox.png" });
});

test("vault immediately applies a character and clears its predecessor's shots and wind-up", async ({
  page,
}) => {
  await page.clock.install();
  await page.clock.pauseAt(new Date());
  await page.goto("/home");
  await page.evaluate(async () => {
    const path = "/src/stores/game-store.ts";
    const { useGameStore } = await import(path);
    const { game } = useGameStore.getState();
    useGameStore.setState({
      paused: true,
      game: {
        ...game,
        dinosaur: 0,
        battlePaused: true,
        combat: {
          ...game.combat,
          hp: 45,
          wave: 2,
          killed: 7,
          pendingGold: 210,
          attackIn: 5000,
          recovery: 0,
          transition: null,
          spawnIn: 5000,
          playerProjectiles: [
            {
              id: "old",
              dinosaur: 0,
              x: 200,
              y: 200,
              vx: 240,
              vy: 0,
              age: 80,
              travelled: 20,
              damage: 20,
              critical: false,
            },
          ],
          projectiles: [{ id: "enemy", art: 0, origin: 7, distance: 4, damage: 5 }],
          lastAttack: {
            time: 0,
            mode: "ranged",
            duration: 500,
            impactAt: 150,
            distance: 7,
            damage: 20,
            critical: false,
            resolved: false,
          },
        },
      },
    });
  });
  await page.getByRole("link", { name: "Character", exact: true }).click();
  await page.getByRole("button", { name: "프테라 선택", exact: true }).click();
  await expect(page).toHaveURL(/\/character$/);
  await expect(page.locator(".vault-apply")).toHaveCount(0);
  await expect(page.locator(".vault-hero h3")).toHaveText("프테라");
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("rexrun-demo-game-v1")!));
  expect(saved.dinosaur).toBe(4);
  expect(saved.combat.playerProjectiles).toEqual([]);
  expect(saved.combat.lastAttack).toBeNull();
  expect(saved.combat.projectiles).toHaveLength(1);
  expect(saved.combat).toMatchObject({
    hp: 45,
    wave: 2,
    killed: 7,
    pendingGold: 210,
    attackIn: 5000,
  });
  await page.reload();
  await page.getByRole("link", { name: "Home", exact: true }).click();
  await expect(page.locator(".battle-dinosaur")).toHaveAttribute("data-dinosaur", "4");
  await expect(page.locator(".player-projectile")).toHaveCount(0);
  await page.getByRole("button", { name: "모험 재개" }).click();
  await page.clock.runFor(500);
  await expect(page.locator(".player-projectile")).toHaveCount(0);
});
