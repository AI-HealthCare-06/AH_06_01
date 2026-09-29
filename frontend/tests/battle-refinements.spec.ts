import { expect, test } from "@playwright/test";

test("background changes only after 1-10 and progress uses the growing target", async ({
  page,
}) => {
  await page.clock.install();
  await page.clock.pauseAt(new Date());
  await page.goto("/quests");
  await page.evaluate(async () => {
    const path = "/src/stores/game-store.ts";
    const { useGameStore } = await import(path);
    useGameStore.setState((state: { game: object }) => ({
      game: { ...state.game, battleDefeats: 144 },
    }));
  });
  await page.getByRole("link", { name: "Home", exact: true }).click();
  await expect(page.locator(".stage-label")).toContainText("STAGE 1-10");
  const bar = page.getByRole("progressbar", { name: "스테이지 몬스터 처치" });
  await expect(bar).toHaveAttribute("aria-valuenow", "18");
  await expect(bar).toHaveAttribute("aria-valuemax", "19");
  await page.clock.runFor(3680);
  await expect(bar).toHaveAttribute("aria-valuenow", "19");
  await expect(page.locator(".battle-scenery")).toHaveAttribute(
    "aria-label",
    "ALPINE DAY 스테이지 배경",
  );
  await page.clock.runFor(1120);
  await expect(page.locator(".stage-label")).toContainText("STAGE 2-1");
  await expect(bar).toHaveAttribute("aria-valuenow", "0");
  await expect(bar).toHaveAttribute("aria-valuemax", "20");
  await expect(page.locator(".battle-scenery")).toHaveAttribute(
    "aria-label",
    "FOREST RUINS 스테이지 배경",
  );
  await page.reload();
  await expect(page.locator(".stage-label")).toContainText("STAGE 2-1");
});

test("pending quests replace finished rows and HUD buffs follow completion and reset", async ({
  page,
}) => {
  await page.goto("/home");
  await page.evaluate(async () => {
    const path = "/src/stores/game-store.ts";
    const { useGameStore } = await import(path);
    useGameStore.getState().complete("meal");
  });
  const rows = page.locator(".compact-quest");
  await expect(rows).toHaveCount(4);
  await expect(rows.nth(0)).toContainText("약 복용하기");
  await expect(rows.nth(1)).toContainText("6,000걸음");
  await expect(rows.nth(2)).toContainText("물 8잔");
  await expect(rows.nth(3)).toContainText("수면 7시간");
  await expect(page.locator('.battle-buffs [data-active="true"]')).toHaveCount(1);
  await expect(page.getByRole("link", { name: "식사 버프 활성: 공격 속도 +15%" })).toBeVisible();
  await page.evaluate(async () => {
    const path = "/src/stores/game-store.ts";
    const { useGameStore } = await import(path);
    const store = useGameStore.getState();
    store.complete("medicine");
    store.complete("water");
    store.complete("sleep");
    store.syncSteps({
      date: store.game.date,
      count: 6000,
      source: "healthkit",
      syncedAt: Date.now(),
    });
  });
  await expect(page.locator('.battle-buffs [data-active="true"]')).toHaveCount(5);
  await expect(page.getByRole("meter", { name: "공룡 체력" })).toHaveAttribute(
    "aria-valuemax",
    "380",
  );
  await expect(page.locator(".hp-heart")).toHaveCount(0);
  await expect(rows.locator(".pixel-check")).toHaveCount(4);
  await page.evaluate(async () => {
    const path = "/src/stores/game-store.ts";
    const { useGameStore } = await import(path);
    useGameStore.getState().resetDemo();
  });
  await expect(page.locator('.battle-buffs [data-active="true"]')).toHaveCount(0);
});

test("Pteranodon flaps its wing, dives down-right with the new sheet, and pauses", async ({
  page,
}) => {
  await page.clock.install();
  await page.clock.pauseAt(new Date());
  await page.goto("/home");
  await page.evaluate(async () => {
    const path = "/src/stores/game-store.ts";
    const { useGameStore } = await import(path);
    useGameStore.getState().chooseDinosaur(4);
  });
  const dino = page.locator(".battle-dinosaur");
  const canvas = dino.locator("canvas");
  await expect(canvas).toHaveAttribute("data-src", "/assets/battle/434-578.png");
  await expect
    .poll(() =>
      canvas.evaluate(
        (e) => (e as HTMLCanvasElement).getContext("2d")!.getImageData(80, 80, 1, 1).data[3],
      ),
    )
    .toBeGreaterThan(0);
  const initial = await canvas.evaluate((e) => (e as HTMLCanvasElement).toDataURL());
  await page.clock.runFor(240);
  await expect
    .poll(() => canvas.evaluate((e) => (e as HTMLCanvasElement).toDataURL()))
    .not.toBe(initial);
  const idle = await dino.evaluate((e) => ({
    left: parseFloat(getComputedStyle(e).left),
    bottom: parseFloat(getComputedStyle(e).bottom),
  }));
  await page.clock.runFor(1840);
  await expect(dino).toHaveAttribute("data-attacking", "true");
  await expect(canvas).toHaveAttribute("data-frame", "4");
  const impact = await dino.evaluate((e) => ({
    left: parseFloat(getComputedStyle(e).left),
    bottom: parseFloat(getComputedStyle(e).bottom),
  }));
  expect(impact.left).toBeGreaterThan(idle.left + 90);
  expect(impact.bottom).toBeLessThan(idle.bottom - 25);
  await page.clock.runFor(1600);
  await expect(dino).toHaveAttribute("data-moving", "true");
  await page.clock.runFor(160);
  const flight = await canvas.getAttribute("data-wing-phase");
  await page.getByRole("button", { name: "모험 일시정지" }).click();
  await page.clock.runFor(1000);
  await expect(canvas).toHaveAttribute("data-wing-phase", flight!);
});
