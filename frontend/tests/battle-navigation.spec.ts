import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.clock.install({ time: new Date("2026-09-30T00:00:00Z") });
  await page.clock.pauseAt(new Date("2026-09-30T00:01:00Z"));
  await page.goto("/home");
});

test("wave arrows persist their destination, retain EXP and only start after the banner", async ({
  page,
}) => {
  await expect(page.getByRole("button", { name: "이전 웨이브" })).toBeDisabled();
  await page.evaluate(async () => {
    const path = "/src/stores/game-store.ts";
    const { useGameStore } = await import(path);
    useGameStore.setState(({ game }: { game: { combat: object } }) => ({
      game: {
        ...game,
        experience: 50,
        combat: { ...game.combat, pendingGold: 120, hp: 3 },
      },
    }));
  });
  await page.getByRole("button", { name: "다음 웨이브" }).click();
  await expect(page.locator(".stage-label")).toHaveText("WAVE 2 / 10");
  await expect(page.locator(".battle-start")).toContainText("WAVE 2 START!");
  await expect(page.getByRole("meter", { name: "공룡 체력", exact: true })).toHaveAttribute(
    "aria-valuenow",
    "50",
  );
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("rexrun-demo-game-v1")!));
  expect(saved).toMatchObject({ experience: 50, gold: 1280, combat: { wave: 2, pendingGold: 0 } });
  await page.reload();
  await expect(page.locator(".stage-label")).toHaveText("WAVE 2 / 10");
  await page.clock.runFor(950);
  await expect(page.locator(".battle-start")).toBeVisible();
  await expect(page.locator(".battle-enemy")).toHaveCount(0);
  await page.clock.runFor(100);
  await expect(page.locator(".battle-start")).toHaveCount(0);
  await expect(page.locator(".battle-enemy")).toHaveCount(1);
  await page.getByRole("button", { name: "이전 웨이브" }).click();
  await expect(page.locator(".stage-label")).toHaveText("WAVE 1 / 10");
  await page.getByRole("button", { name: "모험 일시정지" }).click();
  for (let i = 1; i < 10; i++) await page.getByRole("button", { name: "다음 웨이브" }).click();
  await expect(page.getByRole("button", { name: "다음 웨이브" })).toBeDisabled();
  await expect(page.locator(".stage-label")).toHaveText("WAVE 10 / 10");
  await expect(page.getByRole("button", { name: "모험 재개" })).toBeVisible();
});

test("stage chooser honors level gates, restores focus and displays the selected map", async ({
  page,
}) => {
  const open = page.getByRole("button", { name: /스테이지 선택/ });
  await open.click();
  await expect(page.getByRole("dialog", { name: "STAGE SELECT" })).toBeVisible();
  await expect(page.getByRole("button", { name: /STAGE 2 ·/ })).toBeDisabled();
  await page.keyboard.press("Escape");
  await expect(open).toBeFocused();
  await page.evaluate(async () => {
    const path = "/src/stores/game-store.ts",
      exp = "/src/domain/experience.ts";
    const { useGameStore } = await import(path),
      { experienceForLevel } = await import(exp);
    useGameStore.setState(({ game }: { game: object }) => ({
      game: { ...game, experience: experienceForLevel(7) },
    }));
  });
  await open.click();
  await expect(page.getByRole("button", { name: /STAGE 3 ·/ })).toBeDisabled();
  await page.getByRole("button", { name: /STAGE 2 ·/ }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(open).toBeFocused();
  await expect(page.locator('.battle-scenery[role="img"]')).toHaveAttribute(
    "aria-label",
    "FOREST RUINS 스테이지 배경",
  );
  await expect(page.locator('.battle-scenery[role="img"]')).toHaveCSS(
    "background-position-x",
    "0px",
  );
  await expect(page.locator(".battle-start")).toContainText("WAVE 1 START!");
  await page.reload();
  await expect(open).toContainText("STAGE 2");
});

test("stone defeat countdown pauses and responsive battle controls stay separated", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.evaluate(async () => {
    const path = "/src/stores/game-store.ts";
    const { useGameStore } = await import(path);
    useGameStore.setState(({ game }: { game: { combat: object } }) => ({
      game: {
        ...game,
        combat: { ...game.combat, hp: 0, recovery: 8000 },
      },
    }));
  });
  const defeat = page.locator(".battle-recovery");
  await expect(defeat).toContainText("DEFEAT");
  await expect(defeat.locator("small")).toHaveText("08초 후 재시작");
  await page.getByRole("button", { name: "모험 일시정지" }).click();
  await page.clock.runFor(1000);
  await expect(defeat.locator("small")).toHaveText("08초 후 재시작");
  for (const width of [320, 390, 542]) {
    await page.setViewportSize({ width, height: 694 });
    await page.evaluate(() => document.fonts.ready);
    const stage = (await page.locator(".battle-stage-select").boundingBox())!;
    const waves = (await page.locator(".battle-wave-navigation").boundingBox())!;
    expect(stage.x + stage.width).toBeLessThan(waves.x);
    expect(waves.x + waves.width).toBeLessThan(width);
    await expect(defeat).toBeInViewport();
    if (width === 390) await page.screenshot({ path: "test-results/stone-defeat.png" });
    await page.getByRole("button", { name: /스테이지 선택/ }).click();
    const dialog = (await page.getByRole("dialog").boundingBox())!;
    expect(dialog.x).toBeGreaterThanOrEqual(0);
    expect(dialog.x + dialog.width).toBeLessThanOrEqual(width);
    if (width === 390) await page.screenshot({ path: "test-results/stage-selector.png" });
    await page.keyboard.press("Escape");
  }
  await page.getByRole("button", { name: "모험 재개" }).click();
  await page.clock.runFor(8000);
  await expect(defeat).toHaveCount(0);
  await expect(page.getByRole("meter", { name: "공룡 체력", exact: true })).toHaveAttribute(
    "aria-valuenow",
    "50",
  );
});
