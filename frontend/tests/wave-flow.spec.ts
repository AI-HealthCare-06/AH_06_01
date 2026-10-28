import { expectNoHorizontalOverflow } from "./helpers/layout";
import { selectPixelOption } from "./helpers/controls";
import { expect, test } from "@playwright/test";

test("wave clear, background travel, walking and pause use the same simulation clock", async ({
  page,
}) => {
  await page.clock.install({ time: new Date("2026-10-28T03:00:00Z") });
  await page.clock.pauseAt(new Date("2026-10-28T03:01:00Z"));
  await page.goto("/home");
  await page.evaluate(async () => {
    const path = "/src/stores/game-store.ts";
    const { useGameStore } = await import(path);
    const { game } = useGameStore.getState();
    useGameStore.setState({
      game: {
        ...game,
        combat: { ...game.combat, hp: 7, killed: 30, spawned: 30, enemies: [], spawnIn: 3000 },
      },
    });
  });
  await page.clock.runFor(50);
  await expect(page.locator(".battle-clear")).toHaveText(/WAVE CLEAR!/);
  await expect(page.locator(".battle-dinosaur")).toHaveAttribute("data-animation", "clear");
  await page.screenshot({ path: "test-results/wave-clear.png", animations: "disabled" });
  const scene = page.locator('.battle-scenery[role="img"]');
  await expect(scene).toHaveCSS("background-position-x", "0px");
  await page.clock.runFor(500);
  const position = await scene.evaluate((el) => getComputedStyle(el).backgroundPositionX);
  expect(parseFloat(position)).toBe(0);
  await expect(page.locator(".battle-dinosaur canvas")).toHaveAttribute(
    "data-src",
    /TrexIdleSpritesheet/,
  );
  await page.getByRole("button", { name: "모험 일시정지" }).click();
  await page.clock.runFor(2000);
  await expect(scene).toHaveCSS("background-position-x", position);
  await expect(page.locator(".battle-clear")).toBeVisible();
  await page.getByRole("button", { name: "모험 재개" }).click();
  await page.clock.runFor(500);
  await expect(page.locator(".battle-clear")).toHaveCount(0);
  await expect(page.locator(".battle-dinosaur")).toHaveAttribute("data-animation", "walk");
  await expect(page.locator(".battle-dinosaur canvas")).toHaveAttribute(
    "data-src",
    /TrexWalkSpritesheet/,
  );
  await expect(page.locator(".battle-enemy")).toHaveCount(0);
  await page.clock.runFor(1500);
  expect(
    parseFloat(await scene.evaluate((el) => getComputedStyle(el).backgroundPositionX)),
  ).toBeCloseTo(((-1459 / 175) * 218) / 20, 2);
  await page.clock.runFor(1500);
  await expect(page.locator(".stage-label")).toHaveText("WAVE 2 / 10");
  await expect(page.locator(".battle-start")).toContainText("WAVE 2 START!");
  await expect(page.locator(".battle-dinosaur canvas")).toHaveAttribute(
    "data-src",
    /TrexIdleSpritesheet/,
  );
  await expect(page.getByRole("meter", { name: "공룡 체력", exact: true })).toHaveAttribute(
    "aria-valuenow",
    "50",
  );
  const finalX = parseFloat(await scene.evaluate((el) => getComputedStyle(el).backgroundPositionX));
  expect(finalX).toBeCloseTo(((-1459 / 175) * 218) / 10, 2);
  await page.screenshot({ path: "test-results/wave-travel.png" });
  await page.clock.runFor(950);
  await expect(page.locator(".battle-start")).toBeVisible();
  await expect(page.locator(".battle-enemy")).toHaveCount(0);
  await page.clock.runFor(50);
  await expect(page.locator(".battle-start")).toHaveCount(0);
  await page.clock.runFor(50);
  await expect(page.locator(".battle-enemy")).toHaveCount(1);
});

test("debug level controls change real stats and persist without awarding gold", async ({
  page,
}) => {
  await page.clock.install({ time: new Date("2026-10-28T03:00:00Z") });
  await page.clock.pauseAt(new Date("2026-10-28T03:01:00Z"));
  await page.goto("/home");
  await page.getByRole("button", { name: "모험 일시정지" }).click();
  await page.getByRole("button", { name: "전투 디버그 표시" }).click();
  await expect(page.getByRole("button", { name: "디버그 레벨 다운" })).toBeDisabled();
  await page.getByRole("button", { name: "디버그 레벨 업" }).click();
  await page.getByRole("button", { name: "디버그 레벨 업" }).click();
  await expect(page.locator(".battle-hud .level")).toHaveText("Lv.3 · 티라노");
  await expect(page.getByRole("meter", { name: "공룡 체력", exact: true })).toHaveAttribute(
    "aria-valuemax",
    "60",
  );
  const game = await page.evaluate(() => JSON.parse(localStorage.getItem("rexrun-demo-game-v1")!));
  expect(game.experience).toBe(222);
  expect(game.gold).toBe(1280);
  await page.getByRole("button", { name: "디버그 레벨 다운" }).click();
  await page.reload();
  await expect(page.locator(".battle-hud .level")).toHaveText("Lv.2 · 티라노");
});

test("separate customization shop buys once and equips from character inventory", async ({
  page,
}) => {
  await page.clock.install({ time: new Date("2026-10-28T03:00:00Z") });
  await page.clock.pauseAt(new Date("2026-10-28T03:01:00Z"));
  await page.goto("/shop");
  await page.getByRole("button", { name: "꾸미기", exact: true }).click();
  await expect(page).toHaveURL(/\/shop\/customize$/);
  await expect(page.locator(".accessory-item")).toHaveCount(26);
  await page.getByRole("button", { name: "동물 12", exact: true }).click();
  await expect(page.locator(".accessory-item")).toHaveCount(12);
  await page.getByRole("button", { name: "머리 14", exact: true }).click();
  await expect(page.locator(".accessory-item")).toHaveCount(14);
  await page.getByRole("button", { name: "비행사 모자 미리보기" }).click();
  await page.getByRole("button", { name: "520 GOLD로 구매" }).click();
  await expect(page.getByRole("button", { name: "비행사 모자 미리보기" })).toContainText("보유 중");
  await page.getByRole("link", { name: "보유 아이템 ›" }).click();
  await expect(page).toHaveURL(/\/character\?tab=accessories$/);
  await page.getByRole("button", { name: "비행사 모자 장착", exact: true }).click();
  await expect(page.locator(".vault-slot-head img")).toHaveAttribute("src", /AviatorCap.png$/);
  await expect(page.getByRole("button", { name: "머리 장식 관리 · 비행사 모자" })).toBeAttached();
  await page.reload();
  await expect(page.getByRole("button", { name: "비행사 모자 장착 해제" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  expect(
    await page.evaluate(() => JSON.parse(localStorage.getItem("rexrun-demo-game-v1")!).gold),
  ).toBe(760);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("link", { name: "Home", exact: true }).click();
  await expect(page.locator(".battle-dinosaur .equipped-head")).toHaveAttribute(
    "src",
    /AviatorCap.png$/,
  );
});

test("compact report controls, risk ordering and Galaxy-shaped preview fit narrow widths", async ({
  page,
}) => {
  for (const width of [320, 390, 526]) {
    await page.setViewportSize({ width, height: 694 });
    await page.goto("/dashboard");
    const select = page.getByRole("combobox", { name: "건강 변화 조회 기간" });
    await selectPixelOption(select, "year");
    const heading = (await page.locator(".dashboard-heading .page-heading").boundingBox())!;
    const control = (await select.boundingBox())!;
    const label = (await page.locator(".dashboard-period-select > span").first().boundingBox())!;
    const week = (await page.locator(".weekly-calendar").boundingBox())!;
    expect(control.width).toBeGreaterThanOrEqual(64);
    expect(control.y).toBeGreaterThanOrEqual(week.y + week.height);
    expect(heading.y + heading.height).toBeLessThan(week.y);
    expect(label.y + label.height).toBeLessThan(control.y);
    expect(
      await page.locator(".mobile-screen").evaluate((el) => el.getBoundingClientRect().height),
    ).toBe(844);
    await page.getByRole("link", { name: "상세 건강 보고서 웹으로 보기" }).click();
    const risk = (await page.locator(".disease-card").boundingBox())!;
    const trend = (await page.locator(".health-trend").boundingBox())!;
    expect(risk.y).toBeLessThan(trend.y);
    await expectNoHorizontalOverflow(page);
  }
});
