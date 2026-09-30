import { test, expect } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.clock.install({ time: new Date("2026-09-30T00:00:00Z") });
  await page.clock.pauseAt(new Date("2026-09-30T00:01:00Z"));
});

test("debug buffs change actual combat stats without marking quests and reset on reload", async ({
  page,
}) => {
  await page.goto("/home");
  await page.getByRole("button", { name: "모험 일시정지" }).click();
  await expect(page.locator(".weekly-calendar")).toHaveCount(0);
  await page.getByRole("button", { name: "버프 목록 펼치기" }).click();
  await page.getByRole("button", { name: "전투 디버그 표시" }).click();
  for (const [label, value] of [
    ["공격력 증가", "50"],
    ["피해 감소", "30"],
    ["크리티컬 확률", "40"],
    ["추가 GOLD", "20"],
    ["공격속도 증가", "100"],
  ]) {
    await page.getByRole("spinbutton", { name: `디버그 ${label}` }).fill(value);
  }
  const stats = page.locator(".battle-stat-summary");
  await expect(stats).toContainText("공격력30");
  await expect(stats).toContainText("방어력10 피해 −30%");
  await expect(stats).toContainText("크리티컬40%");
  const actual = await page.evaluate(async () => {
    const path = "/src/stores/game-store.ts",
      battle = "/src/domain/battle.ts";
    const { useGameStore } = await import(path),
      { battleBuffStats } = await import(battle);
    return {
      buffs: battleBuffStats(useGameStore.getState().game),
      completed: useGameStore.getState().game.completed,
    };
  });
  expect(actual.buffs).toMatchObject({
    attack: 30,
    attackInterval: 250,
    defBonus: 0.3,
    gold: 1.2,
    crt: 0.4,
  });
  expect(actual.completed).toEqual([]);
  await page.screenshot({ path: "test-results/debug-buffs.png" });
  await page.getByRole("button", { name: "실제 퀘스트 버프로 복원" }).click();
  await expect(stats).toContainText("공격력20");
  await page.getByRole("spinbutton", { name: "디버그 공격력 증가" }).fill("80");
  await page.reload();
  await page.getByRole("button", { name: "버프 목록 펼치기" }).click();
  await expect(stats).toContainText("공격력20");
});

test("dashboard alone shows quest borders and selected dates/ranges drive the report", async ({
  page,
}) => {
  await page.goto("/dashboard");
  await page.evaluate(async () => {
    const path = "/src/stores/game-store.ts";
    const { useGameStore } = await import(path);
    useGameStore.setState(({ game }: { game: object }) => ({
      game: {
        ...game,
        questHistory: { "2026-09-27": 0, "2026-09-28": 2, "2026-09-29": 4, "2026-09-26": 5 },
      },
    }));
  });
  const days = page.locator(".weekly-calendar button");
  for (let i = 0; i < 3; i++) {
    await expect(days.nth(i)).toHaveAttribute("data-past", "true");
    await expect(days.nth(i)).toHaveAttribute("data-completion", String(i));
  }
  await days.nth(2).click();
  await expect(page.getByLabel("조회 기준 날짜")).toHaveValue("2026-09-29");
  await expect(page.locator(".report-body dl")).toContainText("선택일 퀘스트4 / 5");
  await page.getByLabel("건강 변화 조회 기간").selectOption("custom");
  await page.getByLabel("조회 시작일").fill("2026-09-20");
  await expect(page.locator(".dashboard-date-controls p")).toHaveText("2026-09-20 ~ 2026-09-29");
  await expect(page.locator(".trend-column small").first()).toHaveText("09.20");
  await expect(page.locator(".trend-column small").last()).toHaveText("09.29");
  await page.getByLabel("조회 종료일").fill("2026-09-26");
  await expect(page.locator(".report-body dl")).toContainText("선택 주 달성1일");
  await expect(page.getByRole("button", { name: /9월 26일/ })).toHaveAttribute(
    "data-completion",
    "3",
  );
  await page.screenshot({ path: "test-results/dashboard-dates.png" });
  for (const route of ["home", "quests", "shop", "character", "camera"]) {
    await page.goto(`/${route}`);
    await expect(page.locator(".weekly-calendar")).toHaveCount(0);
  }
});

test("vault assets, wallet actions and date controls stay within mobile bounds", async ({
  page,
}) => {
  for (const width of [320, 390, 542]) {
    await page.setViewportSize({ width, height: 844 });
    for (const route of ["character", "shop", "dashboard"]) {
      await page.goto(`/${route}`);
      await page.evaluate(() => document.fonts.ready);
      if (route === "character") {
        await expect(page.locator(".vault-hero h3")).toHaveText("티라노");
        await page.getByRole("button", { name: "다음 공룡" }).click();
        await expect(page.locator(".vault-hero h3")).toHaveText("트리케라");
        await page.getByRole("button", { name: "이전 공룡" }).click();
        for (const img of await page.locator(".character-vault img").all()) {
          await expect
            .poll(() => img.evaluate((node) => (node as HTMLImageElement).naturalWidth))
            .toBeGreaterThan(0);
          const box = (await img.boundingBox())!;
          expect(box.width).toBeGreaterThan(0);
          expect(box.x).toBeGreaterThanOrEqual(0);
          expect(box.x + box.width).toBeLessThanOrEqual(width);
        }
      }
      if (route === "shop") {
        await expect(page.locator(".wallet-heading")).toContainText("GOLD1,280G전환");
        await expect(
          page.getByRole("button", { name: "오늘의 무료 GOLD 10개 받기" }),
        ).toBeVisible();
        const heading = (await page.locator(".wallet-heading").boundingBox())!;
        const description = (await page.locator(".shop-wallet > p").boundingBox())!;
        expect(description.y).toBeGreaterThanOrEqual(heading.y + heading.height);
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
        width,
      );
      if (width === 390) await page.screenshot({ path: `test-results/review-${route}.png` });
    }
  }
});
