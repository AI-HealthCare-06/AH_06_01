import { expect, test } from "@playwright/test";

test("development debug boxes share combat coordinates, follow enemies and preserve controls", async ({
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
        dinosaur: 4,
        battlePaused: true,
        battleUpdatedAt: Date.now(),
        combat: {
          ...game.combat,
          hp: 50,
          recovery: 0,
          clock: 10000,
          attackIn: 0,
          spawnIn: 5000,
          spawned: 3,
          serial: 4,
          lastAttack: null,
          enemies: ["normal", "elite", "boss"].map((rank, i) => ({
            id: i + 1,
            art: i === 0 ? 0 : i + 3,
            rank,
            distance: 2.5 + i * 1.5,
            hp: i === 0 ? 1 : 1000,
            maxHp: 1000,
            ad: 0,
            attackIn: 300,
            ranged: i !== 2,
            hitAt: -1000,
          })),
        },
      },
    });
  });
  const overlay = page.locator("#battle-debug-overlay");
  await expect(overlay).toHaveCount(0);
  await page.getByRole("button", { name: "전투 디버그 표시" }).click();
  const toggle = page.getByRole("button", { name: "전투 디버그 숨기기" });
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  await expect(overlay.locator("rect")).toHaveCount(8);
  await expect(overlay).toHaveCSS("pointer-events", "none");
  await expect(overlay.locator('[data-range-actor="P"]')).toHaveAttribute("data-range", "3");
  await expect(overlay.locator('[data-range-actor="P"] .debug-range-label')).toHaveText(
    "P RANGE 3.00u",
  );
  await expect(overlay.locator('[data-range-actor="M1"] .debug-range-label')).toHaveText(
    "M1 RANGE 2.00u OUT",
  );
  await expect(overlay.locator(".debug-player-range .debug-range-boundary")).toHaveAttribute(
    "x1",
    "158",
  );
  await expect(overlay.locator('[data-range-actor="M1"]')).toHaveAttribute("data-range", "2");
  expect(
    Number(await overlay.locator('[data-range-actor="M2"]').getAttribute("data-range")),
  ).toBeGreaterThan(2);
  expect(
    Number(await overlay.locator('[data-range-actor="M3"]').getAttribute("data-range")),
  ).toBeGreaterThan(1);

  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 844 });
    const unitWidths = [];
    for (const id of ["P", "M1", "M2", "M3"]) {
      const range = overlay.locator(`[data-range-actor="${id}"]`);
      const origin = Number(await range.locator('[data-range-tick="0"]').getAttribute("x1"));
      const tick = Number(await range.locator('[data-range-tick="1"]').getAttribute("x1"));
      expect(tick - origin).toBe(30);
      expect(origin).toBe(68);
      unitWidths.push(
        await range.evaluate((node) => {
          const a = node.querySelector('[data-range-tick="0"]')!.getBoundingClientRect();
          const b = node.querySelector('[data-range-tick="1"]')!.getBoundingClientRect();
          return Math.abs(b.x - a.x);
        }),
      );
    }
    for (const value of unitWidths) expect(value).toBeCloseTo(unitWidths[0], 2);
    const actors = [
      page.locator(".battle-dinosaur"),
      ...(await page.locator(".battle-enemy").all()),
    ];
    for (const [i, actor] of actors.entries()) {
      if (i > 0) {
        const range = overlay.locator(`[data-range-actor="M${i}"]`);
        const reach = Number(await range.getAttribute("data-range"));
        const ruler = range.locator(".debug-range-ruler");
        const x1 = Number(await ruler.getAttribute("x1"));
        const x2 = Number(await ruler.getAttribute("x2"));
        expect(x2 - x1).toBeCloseTo(reach * 30);
        expect(x1).toBe(68);
        const position = Number(
          await range.locator(".debug-range-position").getAttribute("data-position-x"),
        );
        expect(position).toBeCloseTo(
          await actor.evaluate((node) => parseFloat((node as HTMLElement).style.left)),
        );
        expect(Number(await range.locator(".debug-range-boundary").getAttribute("x1"))).toBeCloseTo(
          x2,
        );
        expect(Number(await range.locator(".debug-range-anchor").getAttribute("x2"))).toBeCloseTo(
          JSON.parse((await actor.getAttribute("data-hitbox"))!).x,
        );
        const scale = await page
          .locator(".design-canvas-inner")
          .evaluate((node) => node.getBoundingClientRect().width / 354);
        const width = await ruler.evaluate((node) => node.getBoundingClientRect().width);
        expect(width).toBeCloseTo(reach * 30 * scale, 2);
      }
      for (const kind of ["collider", "hitbox"]) {
        const box = JSON.parse((await actor.getAttribute(`data-${kind}`))!);
        const rect = overlay.locator(
          `[data-debug-actor="${i === 0 ? "P" : `M${i}`}"] [data-box="${kind}"]`,
        );
        for (const [key, value] of Object.entries(box)) {
          await expect(rect).toHaveAttribute(key, String(value));
        }
        await expect
          .poll(async () => {
            const arena = (await page.locator(".design-canvas-inner").boundingBox())!;
            // DOM geometry excludes the SVG stroke that Playwright's boundingBox includes.
            const rendered = await rect.evaluate((node) => node.getBoundingClientRect().toJSON());
            const scale = arena.width / 354;
            return Math.max(
              Math.abs(rendered.x - (arena.x + box.x * scale)),
              Math.abs(rendered.y - (arena.y + box.y * scale)),
              Math.abs(rendered.width - box.width * scale),
              Math.abs(rendered.height - box.height * scale),
            );
          })
          .toBeLessThan(1);
      }
    }
  }

  const elite = overlay.locator('[data-debug-actor="M2"] [data-box="collider"]');
  const before = Number(await elite.getAttribute("x"));
  await page.getByRole("button", { name: "모험 재개" }).click();
  await page.clock.runFor(1000);
  await expect(overlay.locator('[data-debug-actor="M1"]')).toHaveCount(0);
  await expect(overlay.locator('[data-range-actor="M1"]')).toHaveCount(0);
  expect(Number(await elite.getAttribute("x"))).toBeLessThan(before);
  await page.getByRole("button", { name: "모험 일시정지" }).click();
  const frozen = await elite.getAttribute("x");
  await page.clock.runFor(1000);
  await expect(elite).toHaveAttribute("x", frozen!);
  await page.getByRole("button", { name: "버프 목록 펼치기" }).click();
  await expect(page.getByRole("button", { name: "ATK 버프 현황" })).toBeVisible();
  await toggle.focus();
  await page.keyboard.press("Enter");
  await expect(overlay).toHaveCount(0);
  await expect(page.getByRole("button", { name: "전투 디버그 표시" })).toHaveAttribute(
    "aria-pressed",
    "false",
  );
});

test("monster range status uses the exact combat threshold including body contact", async ({
  page,
}) => {
  await page.clock.install();
  await page.clock.pauseAt(new Date());
  await page.goto("/home");
  await page.getByRole("button", { name: "전투 디버그 표시" }).click();
  for (const offset of [0.001, 0, -0.001]) {
    const range = await page.evaluate(async (offset) => {
      const storePath = "/src/stores/game-store.ts";
      const rangePath = "/src/domain/battle-range.ts";
      const { useGameStore } = await import(storePath);
      const { enemyAttackRange } = await import(rangePath);
      const { game } = useGameStore.getState();
      const enemy = {
        id: 42,
        art: 3,
        rank: "normal",
        ranged: false,
        hp: 1000,
        maxHp: 1000,
        ad: 0,
        attackIn: 0,
        hitAt: -1000,
      };
      const range = enemyAttackRange(enemy, 0);
      useGameStore.setState({
        paused: true,
        game: {
          ...game,
          dinosaur: 0,
          battlePaused: true,
          combat: {
            ...game.combat,
            recovery: 0,
            lastAttack: null,
            enemies: [{ ...enemy, distance: range + offset }],
          },
        },
      });
      return range;
    }, offset);
    const indicator = page.locator('[data-range-actor="M42"]');
    expect(range).toBeGreaterThan(1);
    await expect(indicator).toHaveAttribute("data-range", String(range));
    await expect(indicator).toHaveAttribute("data-in-range", String(offset <= 0));
    const marker = Number(
      await indicator.locator(".debug-range-position").getAttribute("data-position-x"),
    );
    const boundary = Number(await indicator.locator(".debug-range-boundary").getAttribute("x1"));
    expect(marker - boundary).toBeCloseTo(offset * 30, 8);
    await expect(indicator.locator(".debug-range-label")).toHaveText(
      `M42 RANGE ${range.toFixed(2)}u ${offset <= 0 ? "IN" : "OUT"}`,
    );
  }
});

test("monster debug boundary agrees with damage, cooldown and knockback for melee, ranged and boss", async ({
  page,
}) => {
  await page.clock.install();
  await page.clock.pauseAt(new Date());
  await page.goto("/home");
  await page.getByRole("button", { name: "전투 디버그 표시" }).click();
  for (const [art, dinosaur] of [
    [0, 0],
    [3, 4],
    [5, 5],
  ]) {
    for (const [phase, hp, inside] of [
      ["approach", 50, false],
      ["attack", 40, true],
      ["cooldown", 40, true],
      ["knockback", 40, false],
      ["attack-again", 30, true],
    ] as const) {
      const result = await page.evaluate(
        async ({ art, dinosaur, phase }) => {
          const storePath = "/src/stores/game-store.ts";
          const gamePath = "/src/domain/game.ts";
          const battlePath = "/src/domain/battle.ts";
          const rangePath = "/src/domain/battle-range.ts";
          const { useGameStore } = await import(storePath);
          const { initialGame } = await import(gamePath);
          const { advanceCombat, battleBuffStats } = await import(battlePath);
          const { enemyAttackRange } = await import(rangePath);
          let { game } = useGameStore.getState();
          if (phase === "approach") {
            game = { ...initialGame(), dinosaur, battlePaused: true };
            const enemy = {
              id: 42,
              art,
              rank: art === 5 ? "boss" : "normal",
              ranged: art % 2 === 0,
              hp: 1000,
              maxHp: 1000,
              ad: 20,
              attackIn: 0,
              hitAt: -1000,
            };
            game.combat = {
              ...game.combat,
              clock: 10000,
              spawnIn: 5000,
              spawned: 1,
              serial: 43,
              attackIn: 1000,
              enemies: [{ ...enemy, distance: enemyAttackRange(enemy, dinosaur) + 0.1 }],
            };
          }
          if (phase === "knockback") game.combat.attackIn = 0;
          if (phase === "attack-again") game.combat.attackIn = 5000;
          const { combat } = advanceCombat(
            game.combat,
            battleBuffStats(game),
            1,
            phase === "attack-again" ? 500 : 50,
          );
          useGameStore.setState({
            paused: true,
            game: { ...game, combat, battleUpdatedAt: Date.now() },
          });
          return {
            hp: combat.hp,
            enemy: combat.enemies[0],
            range: enemyAttackRange(combat.enemies[0], dinosaur),
          };
        },
        { art, dinosaur, phase },
      );
      expect(result.hp, `${art}/${dinosaur}: ${phase}`).toBe(hp);
      const indicator = page.locator('[data-range-actor="M42"]');
      await expect(indicator).toHaveAttribute("data-in-range", String(inside));
      const position = Number(
        await indicator.locator(".debug-range-position").getAttribute("data-position-x"),
      );
      const boundary = Number(await indicator.locator(".debug-range-boundary").getAttribute("x1"));
      expect(position).toBeCloseTo(68 + result.enemy.distance * 30);
      expect(boundary).toBeCloseTo(68 + result.range * 30);
      expect(position <= boundary).toBe(inside);
      if (inside)
        await expect(indicator.locator(".debug-range-detail")).toContainText(
          `쿨타임 ${result.enemy.attackIn}ms`,
        );
      else
        await expect(indicator.locator(".debug-range-detail")).toContainText(
          `남음 ${(result.enemy.distance - result.range).toFixed(2)}u`,
        );
    }
  }
});
