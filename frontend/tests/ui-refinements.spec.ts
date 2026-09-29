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

test("wallet contains its bonus action and the larger catalog scrolls independently", async ({
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
    const region = page.getByRole("region", { name: "상품 목록" });
    expect(await region.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(
      true,
    );
    await region.focus();
    const tabsBefore = await page.locator(".shop-tabs").boundingBox();
    await region.press("End");
    await expect
      .poll(async () =>
        region.evaluate(
          (element) => element.scrollHeight - element.clientHeight - element.scrollTop,
        ),
      )
      .toBeLessThan(2);
    expect(await page.locator(".shop-tabs").boundingBox()).toEqual(tabsBefore);
    await expect(page.locator(".product-3 > strong")).toBeInViewport();
    await expect(page.getByRole("link", { name: "Home", exact: true })).toBeVisible();
  }
});
