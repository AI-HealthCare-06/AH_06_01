import { expect, test } from "@playwright/test";

test("boss ends wave ten and changes background only when next stage is unlocked", async ({
  page,
}) => {
  await page.clock.install();
  await page.clock.pauseAt(new Date());
  await page.goto("/home");
  await page.evaluate(async () => {
    const path = "/src/stores/game-store.ts";
    const { useGameStore } = await import(path);
    useGameStore.setState((state: { game: { combat: object } }) => ({
      game: {
        ...state.game,
        experience: 550,
        combat: {
          ...state.game.combat,
          wave: 10,
          killed: 100,
          spawned: 101,
          spawnIn: 5000,
          enemies: [
            {
              id: 0,
              art: 5,
              rank: "boss",
              hp: 1,
              maxHp: 683,
              ad: 37.5,
              distance: 2.9,
              attackIn: 500,
              ranged: false,
              hitAt: -1000,
            },
          ],
        },
      },
    }));
  });
  await expect(page.locator(".stage-label")).toContainText("STAGE 1");
  await expect(page.locator(".stage-label")).toContainText("WAVE 10 / 10");
  await expect(page.getByRole("progressbar", { name: "스테이지 몬스터 처치" })).toHaveAttribute(
    "aria-valuemax",
    "101",
  );
  await page.clock.runFor(50);
  await expect(page.locator(".stage-label")).toContainText("STAGE 2");
  await expect(page.locator(".stage-label")).toContainText("WAVE 1 / 10");
  await expect(page.locator(".battle-scenery")).toHaveAttribute(
    "aria-label",
    "FOREST RUINS 스테이지 배경",
  );
  await page.getByRole("button", { name: "모험 일시정지" }).click();
  await page.reload();
  await expect(page.locator(".stage-label")).toContainText("STAGE 2");
});

test("pending quests and compact buff explanations reflect the actual linked stat", async ({
  page,
}) => {
  await page.goto("/home");
  await page.evaluate(async () => {
    const path = "/src/stores/game-store.ts";
    const { useGameStore } = await import(path);
    useGameStore.getState().complete("meal");
  });
  await expect(page.locator(".compact-quest").nth(1)).toContainText("6,000걸음");
  await expect(page.locator(".battle-buffs button")).toHaveText([
    "ATK",
    "DEF",
    "CRT",
    "SPD",
    "GOLD",
  ]);
  const button = page.getByRole("button", { name: "DEF 버프 현황" });
  await button.click();
  const detail = page.getByRole("region", { name: "DEF 상세" });
  await expect(detail).toContainText("받는 피해 −20%");
  await expect(detail.getByRole("link")).toHaveAttribute("href", "/quests/meal");
  const box = (await button.boundingBox())!;
  expect((await detail.boundingBox())!.y).toBeGreaterThan(box.y + box.height);
  await page.keyboard.press("Escape");
  await expect(detail).toHaveCount(0);
  await expect(button).toBeFocused();
  await page.getByRole("button", { name: "GOLD 버프 현황" }).click();
  await expect(page.locator(".battle-buff-detail")).toContainText("수면 데이터 없음");
  await page.getByRole("link", { name: /연계 퀘스트/ }).click();
  await expect(page).toHaveURL(/quests\/sleep$/);
});

test("Pteranodon flaps in place, attacks down-right and freezes when paused", async ({ page }) => {
  await page.clock.install();
  await page.clock.pauseAt(new Date());
  await page.goto("/home");
  await page.evaluate(async () => {
    const path = "/src/stores/game-store.ts";
    const { useGameStore } = await import(path);
    useGameStore.getState().chooseDinosaur(4);
  });
  const dino = page.locator(".battle-dinosaur"),
    canvas = dino.locator("canvas");
  await expect(canvas).toHaveAttribute("data-src", "/assets/battle/434-578.png");
  const initial = await canvas.getAttribute("data-wing-phase");
  await page.clock.runFor(250);
  await expect(canvas).not.toHaveAttribute("data-wing-phase", initial!);
  const idle = await dino.evaluate((e) => ({
    left: parseFloat(getComputedStyle(e).left),
    bottom: parseFloat(getComputedStyle(e).bottom),
  }));
  await page.clock.runFor(3350);
  await expect(dino).toHaveAttribute("data-attacking", "true");
  await expect(canvas).toHaveAttribute("data-frame", "4");
  const attack = await dino.evaluate((e) => ({
    left: parseFloat(getComputedStyle(e).left),
    bottom: parseFloat(getComputedStyle(e).bottom),
  }));
  expect(attack.left).toBeGreaterThan(idle.left + 30);
  expect(attack.bottom).toBeLessThan(idle.bottom - 20);
  await page.getByRole("button", { name: "모험 일시정지" }).click();
  const frame = await canvas.getAttribute("data-frame");
  await page.clock.runFor(1000);
  await expect(canvas).toHaveAttribute("data-frame", frame!);
});

test("demo wallet limits conversion, preserves balances and purchases only cosmetic effects", async ({
  page,
}) => {
  await page.goto("/shop");
  await page.evaluate(async () => {
    const path = "/src/stores/game-store.ts";
    const { useGameStore } = await import(path);
    useGameStore.setState((state: { game: object }) => ({
      paused: true,
      game: { ...state.game, battlePaused: true, gold: 20000 },
    }));
  });
  const wallet = page.getByRole("region", { name: "게임 재화 지갑" });
  await wallet.locator("summary").click();
  await wallet.getByRole("spinbutton", { name: "전환 RP" }).fill("151");
  await expect(wallet.getByRole("button", { name: "데모 RP 전환" })).toBeDisabled();
  await wallet.getByRole("spinbutton", { name: "전환 RP" }).fill("150");
  await wallet.getByRole("button", { name: "데모 RP 전환" }).click();
  await expect(wallet).toContainText("오늘 0");
  await wallet.getByRole("button", { name: /에메랄드 타격/ }).click();
  await expect(wallet.locator("dd")).toHaveText(["0", "1,280", "4,000", "150"]);
  await page.reload();
  await wallet.locator("summary").click();
  await expect(wallet.locator("dd")).toHaveText(["0", "1,280", "4,000", "150"]);
  await page.getByRole("link", { name: "Home", exact: true }).click();
  await expect(page.locator(".adventure")).toHaveAttribute("data-effect", "emerald");
});
