import { expect, test } from "@playwright/test";

for (const [seed, count, cooldown] of [
  [42, 1, 3500],
  [201005, 2, 6300],
  [601017, 3, 6300],
]) {
  test(`spawn group ${count} waits ${cooldown}ms and preserves its remaining cooldown across pause/reload`, async ({
    page,
  }) => {
    await page.clock.install();
    await page.clock.pauseAt(new Date());
    await page.goto("/home");
    await page.evaluate(async (seed) => {
      const path = "/src/stores/game-store.ts";
      const battlePath = "/src/domain/battle.ts";
      const { useGameStore } = await import(path);
      const { initialCombat } = await import(battlePath);
      const { game } = useGameStore.getState();
      useGameStore.setState({
        paused: false,
        game: {
          ...game,
          battlePaused: false,
          battleUpdatedAt: Date.now(),
          debugBuffs: { defBonus: 0.9 },
          combat: { ...initialCombat(), seed, attackIn: 100000 },
        },
      });
    }, seed);
    await page.clock.runFor(50);
    const enemies = page.locator(".battle-enemy");
    await expect(enemies).toHaveCount(count);
    const remainingCooldown = () =>
      page.evaluate(async () => {
        const path = "/src/stores/game-store.ts";
        const { useGameStore } = await import(path);
        return useGameStore.getState().game.combat.spawnIn;
      });
    expect(await remainingCooldown()).toBe(cooldown);
    await page.clock.runFor(cooldown - 100);
    await expect(enemies).toHaveCount(count);
    await page.getByRole("button", { name: "모험 일시정지", exact: true }).click();
    await page.clock.runFor(5000);
    expect(await remainingCooldown()).toBe(100);
    await page.reload();
    await expect(enemies).toHaveCount(count);
    expect(await remainingCooldown()).toBe(100);
    await page.getByRole("button", { name: "모험 재개", exact: true }).click();
    await page.clock.runFor(50);
    await expect(enemies).toHaveCount(count);
    await page.clock.runFor(50);
    expect(await enemies.count()).toBeGreaterThan(count);
    expect(await enemies.count()).toBeLessThanOrEqual(count + 3);
  });
}

test("game controls open three working, persistent settings and account page has no reset toggles", async ({
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
        battlePaused: true,
        combat: {
          ...game.combat,
          clock: 0,
          recovery: 0,
          transition: null,
          lastAttack: null,
          lastHit: { time: 0, x: 240, y: 180, damage: 20, critical: true },
          enemies: [
            {
              id: 1,
              art: 1,
              rank: "normal",
              hp: 96,
              maxHp: 96,
              ad: 0,
              ranged: false,
              distance: 4,
              attackIn: 5000,
              hitAt: -1000,
            },
          ],
        },
      },
    });
  });
  const controls = page.locator(".battle-controls > button");
  await expect(controls).toHaveCount(3);
  expect(
    await controls.evaluateAll((buttons) =>
      buttons.map((button) => button.getAttribute("aria-label")),
    ),
  ).toEqual(["전투 디버그 표시", "모험 재개", "게임 설정"]);
  for (const width of [320, 390, 534]) {
    await page.setViewportSize({ width, height: 844 });
    const hud = (await page.locator(".battle-hud").boundingBox())!;
    const positions = await controls.evaluateAll((buttons) =>
      buttons.map((button) => {
        const box = button.getBoundingClientRect();
        return { x: box.x, right: box.right, y: box.y, height: box.height };
      }),
    );
    expect(positions[0].x).toBeGreaterThan(hud.x + hud.width);
    expect(positions[0].right).toBeLessThanOrEqual(positions[1].x);
    expect(positions[1].right).toBeLessThanOrEqual(positions[2].x);
    expect(positions[0].y).toBe(positions[2].y);
  }
  const trigger = page.getByRole("button", { name: "게임 설정", exact: true });
  await trigger.click();
  const dialog = page.getByRole("dialog", { name: "게임 설정" });
  const names = ["Wave 자동 재시작", "피해 수치 표시", "몬스터 체력바 표시"];
  await expect(dialog.getByRole("switch")).toHaveCount(3);
  for (const name of names) {
    const toggle = dialog.getByRole("switch", { name, exact: true });
    await expect(toggle).toBeChecked();
    await toggle.click();
    await expect(toggle).not.toBeChecked();
  }
  await expect(page.locator(".battle-damage")).toHaveCount(0);
  await expect(page.locator(".enemy-hp")).toHaveCount(0);
  await expect(page.locator(".enemy-status")).toContainText("하드 캔디");
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await page.reload();
  await trigger.click();
  for (const name of names)
    await expect(dialog.getByRole("switch", { name, exact: true })).not.toBeChecked();
  for (const name of names) await dialog.getByRole("switch", { name, exact: true }).click();
  await expect(page.locator(".battle-damage")).toHaveCount(1);
  await expect(page.locator(".enemy-hp")).toHaveAttribute("aria-valuemax", "96");
  await dialog.screenshot({ path: "test-results/game-settings.png" });
  await dialog.getByRole("button", { name: "닫기", exact: true }).click();
  await page.goto("/me");
  await expect(page.getByRole("switch")).toHaveCount(0);
  await expect(page.getByText("일일 상태 초기화", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Wave 자동 재시작", { exact: true })).toHaveCount(0);
});

test("each dinosaur releases its projectile from the visible mouth or foreclaw of its contact pose", async ({
  page,
}) => {
  await page.clock.install();
  await page.clock.pauseAt(new Date());
  await page.goto("/home");
  for (let dinosaur = 0; dinosaur < 6; dinosaur++) {
    const source = await page.evaluate(async (dinosaur) => {
      const path = "/src/stores/game-store.ts";
      const battlePath = "/src/domain/battle.ts";
      const { useGameStore } = await import(path);
      const { advanceCombat, battleBuffStats, initialCombat } = await import(battlePath);
      const { game } = useGameStore.getState();
      const combat = advanceCombat(
        {
          ...initialCombat(),
          spawned: 1,
          spawnIn: 5000,
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
        battleBuffStats({ ...game, dinosaur }),
        1,
        200,
      ).combat;
      useGameStore.setState({
        paused: true,
        game: { ...game, dinosaur, battlePaused: true, combat },
      });
      return combat.playerProjectiles[0];
    }, dinosaur);
    const canvas = page.locator(".battle-dinosaur canvas");
    await expect(canvas).toHaveAttribute("data-rendered-frame", "2");
    await expect
      .poll(() =>
        canvas.evaluate((node, source) => {
          const canvas = node as HTMLCanvasElement;
          const wrap = canvas.parentElement!;
          const width = parseFloat(wrap.style.width),
            height = parseFloat(wrap.style.height);
          const x =
            ((source.x - parseFloat(wrap.style.left)) / width) * 160 -
            parseFloat(canvas.style.left) * 1.6;
          const y =
            ((source.y - parseFloat(wrap.style.top)) / height) * 120 -
            parseFloat(canvas.style.top) * 1.2;
          const pixels = canvas
            .getContext("2d")!
            .getImageData(0, 0, canvas.width, canvas.height).data;
          let opaque = 0;
          for (let dx = -3; dx <= 3; dx++)
            for (let dy = -3; dy <= 3; dy++) {
              const px = Math.round(x) + dx,
                py = Math.round(y) + dy;
              if (px >= 0 && px < canvas.width && py >= 0 && py < canvas.height)
                opaque += pixels[(py * canvas.width + px) * 4 + 3] > 0 ? 1 : 0;
            }
          return opaque;
        }, source),
      )
      .toBeGreaterThan(0);
    await page
      .locator(".pixel-battle")
      .screenshot({ path: `test-results/projectile-release-${dinosaur}.png` });
  }
});

test("prediction delta stays smaller and centered above its arrow on narrow and wide dashboards", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  for (const width of [320, 390, 534]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto("/dashboard");
    await expect(page.locator(".impact-card")).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    for (const row of await page.locator(".impact-card .risk-change").all()) {
      const delta = row.locator("small"),
        arrow = row.locator(".risk-change-arrow");
      const a = (await delta.boundingBox())!,
        b = (await arrow.boundingBox())!;
      expect(a.y + a.height).toBeLessThanOrEqual(b.y + 0.1);
      expect(a.x + a.width / 2).toBeCloseTo(b.x + b.width / 2, 1);
      expect(
        parseFloat(await delta.evaluate((node) => getComputedStyle(node).fontSize)),
      ).toBeLessThan(8);
      expect(await row.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
    }
    await page.locator(".impact-card").screenshot({ path: `test-results/risk-arrow-${width}.png` });
  }
});
