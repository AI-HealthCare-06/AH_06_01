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
    for (const route of ["home", "quests", "dashboard"]) {
      await page.goto(`/${route}`);
      if (route === "dashboard") await page.locator(".growth-insight").waitFor();
      for (const art of await page.locator(".dinosaur-art").all()) {
        await expect(art).toHaveAttribute("data-dinosaur", String(index));
        await expect(art).toHaveAttribute("alt", new RegExp(name));
        if (index !== 0 && (await art.getAttribute("data-pose")) !== "portrait")
          await expect(art).toHaveAttribute("src", image!);
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

test("customization previews without spending Gold and remembers each character's applied style", async ({
  page,
}) => {
  await page.clock.install();
  await page.clock.pauseAt(new Date());
  await page.goto("/shop");
  await page.getByRole("link", { name: "Character", exact: true }).click();
  await expect(page).toHaveURL(/\/character$/);
  await expect(page.locator(".vault-roster button")).toHaveCount(6);
  const before = await page.evaluate(() => localStorage.getItem("rexrun-demo-game-v1"));
  await page.getByRole("button", { name: "스테고 선택", exact: true }).click();
  const preview = page.getByRole("button", { name: "스테고 바다 탐험가 스킨 선택" });
  await preview.click();
  await expect(page.locator(".vault-hero .dinosaur-art")).toHaveAttribute("data-skin", "ocean");
  expect(await page.evaluate(() => localStorage.getItem("rexrun-demo-game-v1"))).toBe(before);
  await page.getByRole("button", { name: "선택한 외형으로 변경" }).click();
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

test("vault keeps six dinosaurs and separate skin/accessory panels usable at narrow widths", async ({
  page,
}) => {
  for (const width of [320, 390, 526]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto("/character");
    await page.evaluate(() => document.fonts.ready);
    await expect(page.locator(".vault-roster button")).toHaveCount(6);
    await expect(page.locator(".vault-skins .style-card")).toHaveCount(9);
    const rows = await page
      .locator(".vault-skins .style-card")
      .evaluateAll(
        (cards) => new Set(cards.map((card) => Math.round(card.getBoundingClientRect().top))).size,
      );
    expect(rows).toBe(3);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    const region = page.locator(".vault-scroll");
    await region.focus();
    await region.press("End");
    await expect(page.getByRole("button", { name: "현재 적용된 외형" })).toBeInViewport();
    await page.getByRole("button", { name: "악세서리", exact: true }).click();
    await expect(page.locator(".vault-skins")).toHaveCount(0);
    await expect(page.getByRole("region", { name: "보유한 꾸미기 아이템" })).toBeVisible();
  }
});
