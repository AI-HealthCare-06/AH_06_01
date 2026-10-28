import { selectPixelOption } from "./helpers/controls";
import { expect, test, type Page } from "@playwright/test";

async function gameStore(
  page: Page,
  change: "owned" | "defeat" | "clear" | "revive" | "retry" | "offline-revive",
) {
  await page.evaluate(async (change) => {
    const source = await (await fetch("/src/App.tsx")).text();
    const url = source.match(/from "([^"]*\/src\/stores\/game-store\.ts[^"]*)"/)![1];
    const { useGameStore } = await import(url);
    const game = useGameStore.getState().game;
    if (change === "owned")
      useGameStore.setState({
        game: { ...game, battlePaused: true, ownedAccessories: ["AviatorCap"] },
      });
    if (change === "defeat")
      useGameStore.setState({
        game: {
          ...game,
          battlePaused: true,
          combat: {
            ...game.combat,
            hp: 0,
            recovery: 10_000,
            lastFailure: { stage: 1, wave: 1, time: game.combat.clock + 100 },
          },
        },
      });
    if (change === "retry") useGameStore.getState().retryWave();
    if (change === "revive") {
      useGameStore.setState({
        game: { ...game, battlePaused: false, battleUpdatedAt: Date.now() - 10_000 },
      });
      useGameStore.getState().tick();
    }
    if (change === "offline-revive")
      useGameStore.setState({
        game: {
          ...game,
          combat: {
            ...game.combat,
            hp: 50,
            recovery: 0,
            lastFailure: { stage: 1, wave: 1, time: game.combat.clock + 200 },
            transition: null,
          },
        },
      });
    if (change === "clear") {
      useGameStore.setState({ game: { ...game, combat: { ...game.combat, transition: null } } });
      useGameStore.setState({
        game: {
          ...game,
          combat: {
            ...game.combat,
            transition: { kind: "wave", elapsed: 0, arrived: false, fromStage: 1, fromWave: 1 },
          },
        },
      });
    }
  }, change);
}

test("dashboard owns its filter, updates its description and routes the quick action to quests", async ({
  page,
}) => {
  await page.goto("/dashboard");
  await expect(page.locator(".main-screen > .quest-calendar")).toHaveCount(0);
  await expect(page.locator(".dashboard-heading .quest-calendar")).toBeVisible();
  await selectPixelOption(page.getByRole("combobox", { name: "건강 변화 조회 기간" }), "month");
  await expect(page.locator(".dashboard-heading .page-heading p")).toContainText("월간");
  await page.reload();
  await expect(page.getByRole("combobox", { name: "건강 변화 조회 기간" })).toContainText("월간");
  await expect(page.locator(".stitch-quest-panel")).toHaveCount(0);
  await expect(page.locator(".greeting .search-button")).toHaveCount(0);
  await page.getByRole("link", { name: "퀘스트", exact: true }).click();
  await expect(page).toHaveURL(/\/quests$/);
});

test("quest tab opens a focused explanation before camera verification and preserves health verification", async ({
  page,
}) => {
  await page.goto("/home");
  await page.getByRole("link", { name: "Quest", exact: true }).click();
  await expect(page.locator(".quest-row")).toHaveCount(4);
  await expect(page.locator("video")).toHaveCount(0);
  const meal = page.getByRole("button", { name: /건강한 식사하기/ });
  await meal.click();
  const dialog = page.getByRole("dialog", { name: "건강한 식사하기", exact: true });
  await expect(dialog).toContainText("직접 촬영한 식사 사진");
  await page.keyboard.press("Escape");
  await expect(meal).toBeFocused();
  await meal.click();
  await dialog.getByRole("button", { name: "인증하기", exact: true }).click();
  await expect(page).toHaveURL(/\/quests$/);
  await expect(
    page.getByRole("dialog", { name: "건강한 식사하기 인증", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("combobox", { name: "기록할 퀘스트" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Quest", exact: true })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await expect(page.locator("#medication-records")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "카메라 켜기", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "카메라 닫기" }).click();
  await expect(meal).toBeFocused();
  await page.getByRole("button", { name: /오늘의 건강 서베이/ }).click();
  await page.getByRole("dialog").getByRole("button", { name: "서베이 작성", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "오늘의 건강 서베이", exact: true })).toBeVisible();
});

test("dinosaur carousel loops in both directions while retaining each skin and balance", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.clock.setFixedTime(new Date("2026-10-22T03:00:00Z"));
  await page.goto("/character");
  const art = page.locator(".vault-hero .character-equipped-preview > .dinosaur-art");
  const gold = await page.evaluate(
    () => JSON.parse(localStorage.getItem("rexrun-demo-game-v1")!).gold,
  );
  await page.getByRole("button", { name: "티라노 사막 스킨 선택", exact: true }).click();
  await page.locator(".vault-roster [aria-pressed='true']").press("ArrowLeft");
  await expect(art).toHaveAttribute("data-dinosaur", "5");
  await page.locator(".vault-roster [aria-pressed='true']").press("ArrowRight");
  await expect(art).toHaveAttribute("data-dinosaur", "0");
  await expect(art).toHaveAttribute("data-skin", "desert");
  for (let i = 1; i <= 12; i++) {
    await page.locator(".vault-roster [aria-pressed='true']").press("ArrowRight");
    await expect(art).toHaveAttribute("data-dinosaur", String(i % 6));
  }
  await expect(
    page.locator(".vault-battle-summary, .vault-inventory, .vault-collection-tabs"),
  ).toHaveCount(0);
  await expect(page.getByText("외형만 바뀌며 모든 공룡의 능력치는 같아요.")).toHaveCount(0);
  expect(
    await page.evaluate(() => JSON.parse(localStorage.getItem("rexrun-demo-game-v1")!).gold),
  ).toBe(gold);
});

test("equipment modals only show owned items and equip without a purchase", async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-10-22T03:00:00Z"));
  await page.goto("/character");
  await gameStore(page, "owned");
  const slot = page.getByRole("button", { name: "머리 장식 관리 · 미장착", exact: true });
  await slot.click();
  const dialog = page.getByRole("dialog", { name: "보유 머리 장식", exact: true });
  await expect(dialog.locator(".equipment-modal-grid button")).toHaveCount(1);
  await dialog.getByRole("button", { name: "비행사 모자 장착", exact: true }).click();
  await dialog.getByRole("button", { name: "닫기", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "머리 장식 관리 · 비행사 모자", exact: true }),
  ).toBeFocused();
  await page.reload();
  await expect(page.locator(".equipped-head")).toHaveCount(1);
  await page.getByRole("button", { name: "동물 동반 관리 · 미장착", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("아직 보유한 아이템이 없어요.");
  await page.getByRole("link", { name: "꾸미기 상점에서 더 보기" }).click();
  await expect(page).toHaveURL(/\/shop\/customize$/);
  await expect(page.locator(".gold-effects")).toBeVisible();
});

test("battle results color the Home tab across navigation without a top notice", async ({
  page,
}) => {
  await page.clock.setFixedTime(new Date("2026-10-22T03:00:00Z"));
  await page.goto("/quests");
  await gameStore(page, "defeat");
  const home = page.getByRole("link", { name: "Home", exact: true });
  await expect(home).toHaveAttribute("data-battle-feedback", "defeat");
  await expect(page.locator(".notice.visible")).toHaveCount(0);
  await page.getByRole("link", { name: "Character", exact: true }).click();
  await expect(home).toHaveAttribute("data-battle-feedback", "defeat");
  await gameStore(page, "revive");
  await expect(home).not.toHaveAttribute("data-battle-feedback", "defeat");
  await expect(home.locator(".battle-nav-badge")).toHaveCount(0);
  await gameStore(page, "defeat");
  await gameStore(page, "retry");
  await expect(home).not.toHaveAttribute("data-battle-feedback", "defeat");
  await gameStore(page, "defeat");
  await gameStore(page, "offline-revive");
  await expect(home).not.toHaveAttribute("data-battle-feedback", "defeat");
  await gameStore(page, "clear");
  await expect(home).toHaveAttribute("data-battle-feedback", "clear");
  await expect(page.locator(".battle-status-announcement")).toHaveText("웨이브 클리어");
});
