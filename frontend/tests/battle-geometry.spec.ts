import { expect, test } from "@playwright/test";

test("all resting hitboxes cover the trimmed artwork exactly with 110% body colliders", async ({
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
        paused: true,
        game: {
          ...game,
          dinosaur,
          battlePaused: true,
          combat: {
            ...game.combat,
            clock: 0,
            recovery: 0,
            lastAttack: null,
            enemies: [
              {
                id: 1,
                art: dinosaur,
                rank: dinosaur === 5 ? "boss" : dinosaur === 4 ? "elite" : "normal",
                distance: 4,
                hp: 100,
                maxHp: 100,
                ad: 0,
                attackIn: 500,
                ranged: false,
                hitAt: -1000,
              },
            ],
          },
        },
      });
    }, dinosaur);
    const player = page.locator(".battle-dinosaur");
    await expect(player).toHaveAttribute("data-dinosaur", String(dinosaur));
    for (const actor of [player, page.locator(".battle-enemy")]) {
      await expect
        .poll(async () =>
          actor.evaluate((node) => {
            const hit = JSON.parse(node.getAttribute("data-hitbox")!);
            const collider = JSON.parse(node.getAttribute("data-collider")!);
            const arena = node.closest(".design-canvas-inner")!.getBoundingClientRect();
            const scale = arena.width / 354;
            const canvas = node.querySelector("canvas")!.getBoundingClientRect();
            return Math.max(
              Math.abs(canvas.x - arena.x - hit.x * scale),
              Math.abs(canvas.y - arena.y - hit.y * scale),
              Math.abs(canvas.width - hit.width * scale),
              Math.abs(canvas.height - hit.height * scale),
              Math.abs(collider.width - hit.width * 1.1),
              Math.abs(collider.height - hit.height * 1.1),
            );
          }),
        )
        .toBeLessThan(0.2);
    }
    if (dinosaur !== 4) {
      const playerBox = (await player.locator("canvas").boundingBox())!;
      const monsterBox = (await page.locator(".battle-enemy canvas").boundingBox())!;
      expect(
        Math.abs(playerBox.y + playerBox.height - monsterBox.y - monsterBox.height),
      ).toBeLessThan(0.2);
    }
  }
});

test("trimmed character attacks reach six differently sized monster hitboxes", async ({ page }) => {
  await page.clock.install({ time: new Date("2026-09-30T00:00:00Z") });
  await page.clock.pauseAt(new Date("2026-09-30T00:01:00Z"));
  await page.goto("/home");
  for (let index = 0; index < 6; index++) {
    await page.evaluate(async (dinosaur) => {
      const path = "/src/stores/game-store.ts";
      const { useGameStore } = await import(path);
      const { game } = useGameStore.getState();
      const rank = dinosaur === 5 ? "boss" : "normal";
      const distance = 2 + dinosaur * 0.15;
      useGameStore.setState({
        paused: true,
        game: {
          ...game,
          dinosaur,
          battlePaused: true,
          combat: {
            ...game.combat,
            clock: 10000,
            recovery: 0,
            lastAttack: {
              time: 9850,
              targetId: 1,
              art: dinosaur,
              rank,
              distance,
              damage: 20,
              critical: false,
            },
            enemies: [
              {
                id: 1,
                art: dinosaur,
                rank,
                distance,
                hp: 100,
                maxHp: 120,
                ad: 20,
                attackIn: 300,
                ranged: false,
                hitAt: 9850,
              },
            ],
          },
        },
      });
    }, index);
    const player = page.locator(".battle-dinosaur"),
      enemy = page.locator(".battle-enemy");
    await expect(player).toHaveAttribute("data-dinosaur", String(index));
    const hitbox = JSON.parse((await enemy.getAttribute("data-hitbox"))!);
    expect(JSON.parse((await enemy.getAttribute("data-collider"))!)).not.toEqual(hitbox);
    expect(JSON.parse((await player.getAttribute("data-collider"))!)).not.toEqual(
      JSON.parse((await player.getAttribute("data-hitbox"))!),
    );
    const scale = await page
      .locator(".design-canvas-inner")
      .evaluate((node) => node.getBoundingClientRect().width / 354);
    const arena = (await page.locator(".design-canvas-inner").boundingBox())!;
    const target = {
      x: arena.x + (hitbox.x + hitbox.width / 2) * scale,
      y: arena.y + (hitbox.y + hitbox.height / 2) * scale,
    };
    await expect
      .poll(async () => {
        const box = (await player.locator("canvas").boundingBox())!;
        return (
          target.x >= box.x &&
          target.x <= box.x + box.width &&
          target.y >= box.y &&
          target.y <= box.y + box.height
        );
      })
      .toBe(true);
    for (const sprite of [player.locator("canvas"), enemy.locator("canvas")]) {
      await expect
        .poll(() =>
          sprite.evaluate((node) => {
            const canvas = node as HTMLCanvasElement,
              { width, height } = canvas;
            const pixels = canvas.getContext("2d")!.getImageData(0, 0, width, height).data;
            const occupied = (x: number, y: number) => pixels[(y * width + x) * 4 + 3] > 0;
            return [
              Array.from({ length: width }, (_, x) => occupied(x, 0)).some(Boolean),
              Array.from({ length: width }, (_, x) => occupied(x, height - 1)).some(Boolean),
              Array.from({ length: height }, (_, y) => occupied(0, y)).some(Boolean),
              Array.from({ length: height }, (_, y) => occupied(width - 1, y)).some(Boolean),
            ].every(Boolean);
          }),
        )
        .toBe(true);
    }
  }
});
