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
    "Camera",
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
  await swipe(page, -100);
  await expect(page).toHaveURL(/\/home$/);
  await expect(page.locator(".home-screen")).toBeVisible();
  await swipe(page, -100, 0, ".dino-feedback");
  await expect(page).toHaveURL(/\/camera$/);
  await expect(page.locator(".camera-screen")).toBeVisible();
  await swipe(page, -100, 0, ".greeting");
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.locator(".dashboard-screen")).toBeVisible();
  await swipe(page, -100, 0, ".greeting");
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.locator(".dashboard-screen")).toBeVisible();
  await swipe(page, 100, 0, ".greeting");
  await expect(page).toHaveURL(/\/camera$/);
  await expect(page.locator(".camera-screen")).toBeVisible();
  await page.goto("/shop/customize");
  await expect(page).toHaveURL(/\/shop\/customize$/);
  await swipe(page, -100);
  await expect(page).toHaveURL(/\/character$/);
});

test("compact HUD toggles buffs and hit art lasts 200ms without stopping attack cooldowns", async ({
  page,
}) => {
  await page.clock.install();
  await page.clock.pauseAt(new Date());
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
              distance: 2,
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
  await page.clock.runFor(50);
  await expect(enemy).toHaveAttribute("data-src", "/assets/battle/RangedDarkColaHit.png");
  await expect(page.locator(".enemy-hp")).toHaveAttribute("aria-valuenow", "980");
  await page.clock.runFor(150);
  await expect(enemy).toHaveAttribute("data-src", "/assets/battle/RangedDarkColaHit.png");
  const cooldown = await page.evaluate(async () => {
    const path = "/src/stores/game-store.ts";
    const { useGameStore } = await import(path);
    return useGameStore.getState().game.combat.enemies[0].attackIn;
  });
  expect(cooldown).toBe(0);
  await page.clock.runFor(50);
  await expect(enemy).toHaveAttribute("data-src", "/assets/battle/RangedDarkColaAttack.png");
  await expect(page.getByRole("meter", { name: "공룡 체력" })).toHaveAttribute(
    "aria-valuenow",
    "50",
  );
  await page.clock.runFor(300);
  await expect(enemy).toHaveAttribute("data-src", "/assets/battle/RangedDarkColaHit.png");
  await expect(page.locator(".enemy-hp")).toHaveAttribute("aria-valuenow", "960");
  await page.clock.runFor(250);
  await expect(page.getByRole("meter", { name: "공룡 체력" })).toHaveAttribute(
    "aria-valuenow",
    "40",
  );
});
