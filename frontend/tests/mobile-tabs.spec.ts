import { expect, test, type Page } from "@playwright/test";

async function swipe(page: Page, dx: number, dy = 0, target = ".page-heading") {
  await page.locator(target).evaluate(
    (element, { dx, dy }) => {
      const start = new Touch({ identifier: 1, target: element, clientX: 190, clientY: 280 });
      const end = new Touch({
        identifier: 1,
        target: element,
        clientX: 190 + dx,
        clientY: 280 + dy,
      });
      element.dispatchEvent(new TouchEvent("touchstart", { bubbles: true, touches: [start] }));
      element.dispatchEvent(new TouchEvent("touchmove", { bubbles: true, touches: [end] }));
      element.dispatchEvent(new TouchEvent("touchend", { bubbles: true, changedTouches: [end] }));
    },
    { dx, dy },
  );
}

test("main tabs follow the requested order and swipe respects direction, edges and forms", async ({
  page,
}) => {
  await page.goto("/shop");
  await expect(page.getByRole("navigation").getByRole("link")).toHaveText([
    "Shop",
    "Character",
    "Home",
    "Quest",
    "Dashboard",
  ]);
  await swipe(page, 100);
  await expect(page).toHaveURL(/\/shop$/);
  await swipe(page, -100, 100);
  await expect(page).toHaveURL(/\/shop$/);
  await page.getByRole("button", { name: "전환 ⇄" }).click();
  await swipe(page, -100, 0, ".economy-wallet input");
  await expect(page).toHaveURL(/\/shop$/);
  await page.keyboard.press("Escape");
  await swipe(page, -100);
  await expect(page).toHaveURL(/\/character$/);
  await expect(page.locator(".character-screen")).toBeVisible();
  await swipe(page, -100, 0, ".vault-skin-grid");
  await expect(page).toHaveURL(/\/character$/);
  await swipe(page, -100, 0, ".vault-heading");
  await expect(page).toHaveURL(/\/home$/);
  await expect(page.locator(".home-screen")).toBeVisible();
  await swipe(page, -100, 0, ".dino-feedback");
  await expect(page).toHaveURL(/\/quests$/);
  await expect(page.locator(".quests-screen")).toBeVisible();
  await swipe(page, -100, 0, ".greeting");
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.locator(".dashboard-screen")).toBeVisible();
  await swipe(page, -100, 0, ".greeting");
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.locator(".dashboard-screen")).toBeVisible();
  await swipe(page, 100, 0, ".greeting");
  await expect(page).toHaveURL(/\/quests$/);
  await expect(page.locator(".quests-screen")).toBeVisible();
  await page.goto("/shop/customize");
  await expect(page).toHaveURL(/\/shop\/customize$/);
  await swipe(page, -100);
  await expect(page).toHaveURL(/\/character$/);
});

test("compact HUD toggles buffs and hit art lasts 200ms without stopping attack cooldowns", async ({
  page,
}) => {
  await page.clock.install({ time: new Date("2026-10-28T03:00:00Z") });
  await page.clock.pauseAt(new Date("2026-10-28T03:01:00Z"));
  await page.goto("/home");
  await expect(page.locator(".battle-buffs")).toBeHidden();
  await page.getByRole("button", { name: "버프 목록 펼치기" }).click();
  await expect(page.locator(".battle-buffs")).toBeVisible();
  await page.getByRole("button", { name: "ATK 버프 현황" }).click();
  await expect(page.locator(".battle-buff-detail")).toBeVisible();
  await page.getByRole("button", { name: "버프 목록 접기" }).click();
  await expect(page.locator(".battle-buff-detail")).toHaveCount(0);
  const hud = (await page.locator(".battle-hud").boundingBox())!;
  const scenery = (await page.locator(".battle-scenery").boundingBox())!;
  expect(hud.x - scenery.x).toBeCloseTo((5 * scenery.width) / 354, 1);
  expect(hud.y - scenery.y).toBeCloseTo((5 * scenery.width) / 354, 1);
  expect(hud.width / scenery.width).toBeCloseTo((194 * 0.8) / 354, 2);
  await page.evaluate(async () => {
    const path = "/src/stores/game-store.ts";
    const { useGameStore } = await import(path);
    const { game } = useGameStore.getState();
    useGameStore.setState({
      game: {
        ...game,
        combat: {
          ...game.combat,
          spawned: 1,
          spawnIn: 5000,
          attackIn: 0,
          enemies: [
            {
              id: 0,
              art: 0,
              rank: "normal",
              hp: 1000,
              maxHp: 1000,
              ad: 20,
              distance: 3,
              attackIn: 100,
              ranged: true,
              hitAt: -1000,
            },
          ],
        },
      },
    });
  });
  const enemy = page.locator(".battle-enemy canvas");
  // Wait for actual projectile impact, rather than damage at attack windup.
  for (let i = 0; i < 15; i++) {
    await page.clock.runFor(50);
    if ((await page.locator(".enemy-hp").getAttribute("aria-valuenow")) === "980") break;
  }
  await expect(enemy).toHaveAttribute("data-src", "/assets/battle/RangedDarkColaHit.png");
  await expect(page.locator(".enemy-hp")).toHaveAttribute("aria-valuenow", "980");
  const cooldown = await page.evaluate(async () => {
    const path = "/src/stores/game-store.ts";
    const { useGameStore } = await import(path);
    const { game } = useGameStore.getState();
    useGameStore.setState({ game: { ...game, combat: { ...game.combat, attackIn: 5000 } } });
    return game.combat.enemies[0].attackIn;
  });
  await page.clock.runFor(150);
  await expect(enemy).toHaveAttribute("data-src", "/assets/battle/RangedDarkColaHit.png");
  const later = await page.evaluate(async () => {
    const path = "/src/stores/game-store.ts";
    const { useGameStore } = await import(path);
    return useGameStore.getState().game.combat.enemies[0].attackIn;
  });
  expect(later).toBe(cooldown - 150);
  await page.clock.runFor(50);
  await expect(enemy).not.toHaveAttribute("data-src", "/assets/battle/RangedDarkColaHit.png");
  await expect(page.getByRole("meter", { name: "공룡 체력" })).toHaveAttribute(
    "aria-valuenow",
    "40",
  );
});
