import { expect, test } from "@playwright/test";

const names = ["티라노", "트리케라", "랩터", "스테고", "프테라", "브라키오"];

for (const [index, name] of names.entries()) {
  test(`${name} stays consistent across the main tabs after selection`, async ({ page }) => {
    await page.goto("/dinosaur");
    const choice = page.getByRole("button", { name: new RegExp(name) });
    const image = await choice.locator("img").getAttribute("src");
    await choice.click();
    await page.getByRole("link", { name: "모험 시작하기" }).click();
    await expect(page.locator(".initial-scene .dinosaur-art")).toHaveAttribute(
      "data-dinosaur",
      String(index),
    );
    for (const route of ["home", "quests", "dashboard"]) {
      await page.goto(`/${route}`);
      if (route === "dashboard") await page.locator(".growth-insight").waitFor();
      for (const art of await page.locator(".dinosaur-art").all()) {
        await expect(art).toHaveAttribute("data-dinosaur", String(index));
        await expect(art).toHaveAttribute("alt", new RegExp(name));
        if (index !== 0) await expect(art).toHaveAttribute("src", image!);
      }
      const text = {
        home: ".feedback-copy",
        quests: ".quest-summary-power",
        dashboard: ".growth-insight h3",
      }[route]!;
      await expect(page.locator(text)).toContainText(name);
    }
    await page.goto("/shop");
    await expect(page.locator(".page-heading p")).toContainText(name);
    await expect(page.locator(".weekly-calendar")).toHaveCount(0);
  });
}

test("customization previews without spending coins and remembers each character's applied style", async ({
  page,
}) => {
  await page.goto("/shop");
  await page.getByRole("button", { name: "꾸미기", exact: true }).click();
  await expect(page).toHaveURL(/\/shop\/customize$/);
  await expect(page.locator(".character-collection")).toHaveCount(6);
  const before = await page.evaluate(() => localStorage.getItem("rexrun-demo-game-v1"));
  const preview = page.getByRole("button", { name: "스테고 바다 탐험가 스타일 미리보기" });
  await preview.click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.locator(".style-preview-scene img")).toHaveAttribute("data-skin", "ocean");
  await page.keyboard.press("Escape");
  await expect(preview).toBeFocused();
  expect(await page.evaluate(() => localStorage.getItem("rexrun-demo-game-v1"))).toBe(before);
  await preview.click();
  await page.getByRole("button", { name: "이 스타일로 함께하기" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.locator(".page-heading p")).toContainText("스테고");
  await expect(page.locator(".wallet-balance > strong")).toHaveText("1,280");
  await page.reload();
  await expect(page.getByRole("button", { name: "꾸미기", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(
    page.getByRole("button", { name: "스테고 바다 탐험가 스타일 미리보기" }),
  ).toHaveAttribute("data-equipped", "true");
  await page.getByRole("link", { name: "Home", exact: true }).click();
  await expect(page.locator(".idle-dino")).toHaveAttribute("data-dinosaur", "3");
  await expect(page.locator(".idle-dino")).toHaveAttribute("data-skin", "ocean");
  await expect(page.locator(".feedback-portrait")).toHaveAttribute("data-skin", "ocean");
  for (const route of ["reward", "buff", "withered"]) {
    await page.goto(`/${route}`);
    await expect(page.locator(".dinosaur-art")).toHaveAttribute("data-dinosaur", "3");
    await expect(page.locator(".dinosaur-art")).toHaveAttribute("data-skin", "ocean");
    await expect(page.locator("main")).toContainText("스테고");
  }
});

test("customization has three rows per character on narrow and desktop screens", async ({
  page,
}) => {
  for (const width of [320, 390, 526]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto("/shop/customize");
    await page.evaluate(() => document.fonts.ready);
    for (const group of await page.locator(".character-collection").all()) {
      await expect(group.locator(".style-card")).toHaveCount(6);
      const rows = await group
        .locator(".style-card")
        .evaluateAll(
          (cards) =>
            new Set(cards.map((card) => Math.round(card.getBoundingClientRect().top))).size,
        );
      expect(rows).toBe(3);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    const region = page.getByRole("region", { name: "꾸미기 목록" });
    await region.focus();
    await region.press("End");
    await expect(
      page.getByRole("button", { name: "브라키오 황금빛 용사 스타일 미리보기" }),
    ).toBeInViewport();
  }
});
