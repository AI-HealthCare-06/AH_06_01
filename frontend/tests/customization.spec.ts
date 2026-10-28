import { expect, test } from "@playwright/test";

const names = ["티라노", "트리케라", "랩터", "스테고", "프테라", "브라키오"];

for (const [index, name] of names.entries()) {
  test(`${name} stays consistent across the main tabs after selection`, async ({ page }) => {
    await page.goto("/dinosaur");
    const choice = page.getByRole("button", { name: new RegExp(name) });
    const image = await choice.locator("img").getAttribute("src");
    const facing = await choice.locator("img").evaluate((img) => getComputedStyle(img).transform);
    await choice.click();
    await page.getByRole("link", { name: "모험 시작하기" }).click();
    await expect(page.locator(".initial-scene .dinosaur-art")).toHaveAttribute(
      "data-dinosaur",
      String(index),
    );
    await expect(page.locator(".initial-scene .dinosaur-art")).toHaveCSS("transform", facing);
    for (const route of ["home", "quests", "character"]) {
      await page.goto(`/${route}`);
      if (route === "character") await page.locator(".vault-hero").waitFor();
      const artSelector =
        route === "character"
          ? ".vault-hero .character-equipped-preview > .dinosaur-art"
          : ".dinosaur-art";
      for (const art of await page.locator(artSelector).all()) {
        await expect(art).toHaveAttribute("data-dinosaur", String(index));
        await expect(art).toHaveAttribute("alt", new RegExp(name));
        if (
          route !== "character" &&
          index !== 0 &&
          (await art.getAttribute("data-pose")) !== "portrait"
        )
          await expect(art).toHaveAttribute("src", image!);
      }
      const text = {
        home: ".feedback-copy",
        quests: ".quest-summary-detail",
        character: ".vault-hero h3",
      }[route]!;
      if (route === "quests")
        await expect(page.locator(".page-heading p")).toContainText("나의 건강 습관");
      else await expect(page.locator(text)).toContainText(name);
    }
    await page.goto("/shop");
    await expect(page.locator(".page-heading p")).toContainText(name);
    await expect(page.locator(".weekly-calendar")).toHaveCount(0);
  });
}

test("character and skin selections apply immediately without spending Gold and persist", async ({
  page,
}) => {
  await page.clock.install({ time: new Date("2026-10-28T03:00:00Z") });
  await page.clock.pauseAt(new Date("2026-10-28T03:01:00Z"));
  await page.goto("/shop");
  await page.getByRole("link", { name: "Character", exact: true }).click();
  await expect(page).toHaveURL(/\/character$/);
  await expect(page.locator(".vault-roster button:not([aria-hidden])")).toHaveCount(6);
  await page.getByRole("button", { name: "스테고 선택", exact: true }).click();
  expect(
    await page.evaluate(() => JSON.parse(localStorage.getItem("rexrun-demo-game-v1")!).dinosaur),
  ).toBe(3);
  const preview = page.getByRole("button", { name: "스테고 바다 탐험가 스킨 선택" });
  await preview.click();
  await expect(
    page.locator(".vault-hero .character-equipped-preview > .dinosaur-art"),
  ).toHaveAttribute("data-skin", "ocean");
  await expect(page.locator(".vault-apply")).toHaveCount(0);
  await expect(page.locator(".vault-hero h3")).toContainText("스테고");
  expect(
    await page.evaluate(() => JSON.parse(localStorage.getItem("rexrun-demo-game-v1")!).gold),
  ).toBe(1280);
  await page.reload();
  await expect(page.getByRole("link", { name: "Character", exact: true })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await expect(page.getByRole("button", { name: "스테고 바다 탐험가 스킨 선택" })).toHaveAttribute(
    "data-equipped",
    "true",
  );
  await page.getByRole("link", { name: "Home", exact: true }).click();
  await expect(page.locator(".battle-dinosaur")).toHaveAttribute("data-dinosaur", "3");
  await expect(page.locator(".battle-dinosaur")).toHaveAttribute("data-skin", "ocean");
  await expect(page.locator(".feedback-portrait")).toHaveAttribute("data-skin", "ocean");
  for (const route of ["reward", "buff", "withered"]) {
    await page.goto(`/${route}`);
    await expect(page.locator(".dinosaur-art")).toHaveAttribute("data-dinosaur", "3");
    await expect(page.locator(".dinosaur-art")).toHaveAttribute("data-skin", "ocean");
    await expect(page.locator("main")).toContainText("스테고");
  }
});

test("vault keeps skin controls, six dinosaurs and inventory usable at narrow widths", async ({
  page,
}) => {
  for (const width of [320, 390, 526]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto("/character");
    await page.evaluate(() => document.fonts.ready);
    await expect(page.locator(".vault-roster button:not([aria-hidden])")).toHaveCount(6);
    await expect(page.getByRole("button", { name: /^티라노 .+ 스킨 선택$/ })).toHaveCount(9);
    const rows = await page.locator(".vault-skins .style-card").evaluateAll(
      (cards) =>
        new Set(
          cards.map((card) => {
            const bounds = card.getBoundingClientRect();
            return Math.round(bounds.top + bounds.height / 2);
          }),
        ).size,
    );
    expect(rows).toBe(1);
    await expect(page.getByRole("button", { name: "스킨", exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "다음 공룡", exact: true })).toHaveCount(0);
    await expect(page.locator(".vault-skin-grid")).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await expect(page.locator(".vault-apply")).toHaveCount(0);
    await page.getByRole("button", { name: "머리 장식 관리 · 미장착", exact: true }).click();
    await expect(page.getByRole("dialog", { name: "보유 머리 장식", exact: true })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("link", { name: "Home", exact: true })).toBeInViewport();
  }
});

test("keyboard navigation wraps, keep the dinosaur selected and remember each dinosaur's skin", async ({
  page,
}) => {
  await page.clock.install({ time: new Date("2026-10-28T03:00:00Z") });
  await page.clock.pauseAt(new Date("2026-10-28T03:01:00Z"));
  await page.goto("/character");
  await page.getByRole("button", { name: "트리케라 선택", exact: true }).click();
  const art = page.locator(".vault-hero .character-equipped-preview > .dinosaur-art");
  await page.locator(".vault-skin-grid [aria-pressed='true']").press("ArrowLeft");
  await expect(art).toHaveAttribute("data-dinosaur", "1");
  await expect(art).toHaveAttribute("data-skin", "gold");
  await expect(page.getByLabel("현재 스킨")).toContainText("SKIN 9 / 9");
  await page.locator(".vault-skin-grid [aria-pressed='true']").press("ArrowRight");
  await expect(art).toHaveAttribute("data-skin", "original");
  await page.locator(".vault-skin-grid [aria-pressed='true']").press("ArrowRight");
  await expect(art).toHaveAttribute("data-skin", "desert");
  await page.getByRole("button", { name: "스테고 선택", exact: true }).click();
  await expect(art).toHaveAttribute("data-skin", "original");
  await page.getByRole("button", { name: "트리케라 선택", exact: true }).click();
  await expect(art).toHaveAttribute("data-skin", "desert");
  await page.reload();
  await expect(art).toHaveAttribute("data-dinosaur", "1");
  await expect(art).toHaveAttribute("data-skin", "desert");
  expect(
    await page.evaluate(() => JSON.parse(localStorage.getItem("rexrun-demo-game-v1")!).gold),
  ).toBe(1280);
});
