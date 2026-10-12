import { expect, test } from "@playwright/test";

test("reduced motion removes decorative battle animations", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/home");
  await expect(page.locator(".battle-dinosaur")).toBeVisible();
  expect(
    await page
      .locator(".pixel-battle *")
      .evaluateAll((elements) => elements.flatMap((element) => element.getAnimations()).length),
  ).toBe(0);
});

test("radar compares day one and today, and risk changes include units and a delta", async ({
  page,
}) => {
  await page.goto("/home");
  await expect(page.getByRole("img", { name: "1일차와 오늘의 공룡 능력치 비교" })).toBeVisible();
  const firstDay = page.locator('.radar-comparison [data-series="day-one"]');
  const today = page.locator('.radar-comparison [data-series="today"]');
  expect(await firstDay.getAttribute("points")).not.toEqual(await today.getAttribute("points"));
  await expect(page.locator(".radar-comparison text")).toHaveText([
    "복약",
    "식사",
    "수면",
    "회복",
    "걸음",
    "체력",
  ]);
  await page.locator(".radar-card").click();
  await expect(page.locator(".risk-change").last()).toHaveAttribute(
    "aria-label",
    "현재 41%, 완료 후 35%, 6%포인트 감소",
  );
  await expect(page.locator(".risk-change-values").last()).toHaveText("41%→35%");
  const colors = await page
    .locator(".risk-change-values")
    .last()
    .evaluate((element) => ({
      from: getComputedStyle(element.children[0]).color,
      gradient: getComputedStyle(element.children[1]).backgroundImage,
      to: getComputedStyle(element.children[2]).color,
    }));
  expect(colors.from).not.toBe(colors.to);
  expect(colors.gradient).toContain(colors.from);
  expect(colors.gradient).toContain(colors.to);
});

test("quest rewards stay centered at the row end on narrow screens", async ({ page }) => {
  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto("/quests");
    await page.evaluate(() => document.fonts.ready);
    for (const row of await page.locator(".quest-row").all()) {
      const box = (await row.boundingBox())!;
      const exp = (await row.locator(".quest-exp").boundingBox())!;
      const copy = (await row.locator(".quest-row-copy").boundingBox())!;
      expect(Math.abs(box.y + box.height / 2 - exp.y - exp.height / 2)).toBeLessThan(1);
      expect(box.x + box.width - exp.x - exp.width).toBeCloseTo(10, 0);
      expect(copy.x + copy.width).toBeLessThanOrEqual(exp.x);
    }
  }
});

test("wallet contains its bonus action and catalog continues to the bottom navigation", async ({
  page,
}) => {
  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto("/shop");
    await page.evaluate(() => document.fonts.ready);
    const wallet = (await page.locator(".shop-wallet").boundingBox())!;
    const bonus = (await page.locator(".daily-bonus").boundingBox())!;
    expect(bonus.x).toBeGreaterThan(wallet.x + wallet.width / 3);
    expect(bonus.y).toBeGreaterThan(wallet.y + wallet.height / 2);
    expect(wallet.x + wallet.width - bonus.x - bonus.width).toBeGreaterThanOrEqual(12);
    expect(wallet.y + wallet.height - bonus.y - bonus.height).toBeGreaterThanOrEqual(12);
    const catalog = (await page.locator(".shop-catalog").boundingBox())!;
    const navigation = (await page.locator(".bottom-navigation").boundingBox())!;
    expect(navigation.y - catalog.y - catalog.height).toBeLessThan(24);
    await expect(page.locator(".product")).toHaveCount(6);
    await expect(page.locator(".shop-tab")).toHaveText(["추천", "꾸미기"]);
    expect(
      await page
        .locator(".daily-bonus")
        .evaluate((element) => element.scrollWidth <= element.clientWidth),
    ).toBe(true);
    const region = page.getByRole("region", { name: "상품 목록" });
    await region.focus();
    await region.press("End");
    await page.locator(".product-5").scrollIntoViewIfNeeded();
    await expect(page.locator(".product-5 > strong")).toBeInViewport();
    expect((await page.locator(".product-5").boundingBox())!.height).toBeCloseTo(206, 0);
    await expect(page.getByRole("link", { name: "Home", exact: true })).toBeVisible();
  }
});

test("feedback follows all flipped face assets and the arrow opens buffs", async ({ page }) => {
  await page.clock.install();
  await page.clock.pauseAt(new Date());
  await page.goto("/home");
  const faces = ["493-579", "493-582", "493-592", "493-585", "493-589", "493-595"];
  for (let dinosaur = 0; dinosaur < faces.length; dinosaur++) {
    await page.evaluate(async (index) => {
      const path = "/src/stores/game-store.ts";
      const { useGameStore } = await import(path);
      useGameStore.getState().chooseDinosaur(index);
    }, dinosaur);
    await expect(page.locator(".feedback-portrait")).toHaveAttribute(
      "src",
      `/assets/battle/${faces[dinosaur]}.png`,
    );
    await expect
      .poll(() =>
        page
          .locator(".feedback-portrait")
          .evaluate((image) => (image as HTMLImageElement).naturalWidth),
      )
      .toBeGreaterThan(0);
  }
  const toggle = page.getByRole("button", { name: "버프 목록 펼치기" });
  await expect(toggle).toHaveText("▾");
  await toggle.click();
  await expect(page.locator(".battle-buffs")).toBeVisible();
  await expect(page.getByRole("button", { name: "버프 목록 접기" })).toHaveText("▴");
  await page.getByRole("button", { name: "퀘스트 찾기" }).click();
  await expect(page).toHaveURL(/\/quests$/);
});
