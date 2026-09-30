import { expect, test } from "@playwright/test";

test("trimmed character attacks reach six differently sized monster hitboxes", async ({ page }) => {
  await page.clock.install();
  await page.clock.pauseAt(new Date());
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
