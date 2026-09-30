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
  await expect(overlay.locator(".debug-range-boundary")).toHaveAttribute("x1", "158");
  await expect(overlay.locator('[data-range-actor="M1"]')).toHaveAttribute("data-range", "2");
  expect(
    Number(await overlay.locator('[data-range-actor="M2"]').getAttribute("data-range")),
  ).toBeGreaterThan(2);
  expect(
    Number(await overlay.locator('[data-range-actor="M3"]').getAttribute("data-range")),
  ).toBeGreaterThan(1);

  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 844 });
    const actors = [
      page.locator(".battle-dinosaur"),
      ...(await page.locator(".battle-enemy").all()),
    ];
    for (const [i, actor] of actors.entries()) {
      if (i > 0) {
        const range = overlay.locator(`[data-range-actor="M${i}"]`);
        const reach = Number(await range.getAttribute("data-range"));
        const ruler = range.locator("line");
        const x1 = Number(await ruler.getAttribute("x1"));
        const x2 = Number(await ruler.getAttribute("x2"));
        expect(x2 - x1).toBeCloseTo(reach * 30);
        expect(x2).toBeCloseTo(
          await actor.evaluate((node) => parseFloat((node as HTMLElement).style.left)),
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
    await expect(indicator.locator("text")).toHaveText(
      `M42 ${range.toFixed(2)}u ${offset <= 0 ? "IN" : "OUT"}`,
    );
  }
});
