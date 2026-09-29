import { expect, test } from "@playwright/test";

test("quest EXP appears below HP in a thin gray and green gauge and survives reload", async ({
  page,
}) => {
  await page.goto("/home");
  const exp = page.getByRole("progressbar", { name: "레벨 경험치" });
  await expect(exp).toHaveText("EXP 000/300");
  const hpBox = (await page.getByRole("meter", { name: "공룡 체력" }).boundingBox())!;
  const expBox = (await exp.boundingBox())!;
  expect(expBox.y).toBeGreaterThan(hpBox.y + hpBox.height);
  expect(expBox.height / hpBox.height).toBeCloseTo(0.4, 1);
  expect(await exp.evaluate((e) => getComputedStyle(e).backgroundColor)).toBe("rgb(119, 125, 125)");
  const stage = page.getByRole("progressbar", { name: "스테이지 몬스터 처치" });
  expect(await stage.evaluate((e) => getComputedStyle(e, "::after").backgroundImage)).toContain(
    "repeating-linear-gradient",
  );
  await expect(page.locator(".stage-egg, .stage-flag, .pixel-stage-dot")).toHaveCount(0);

  await page.goto("/quests/meal");
  await page.getByRole("button", { name: "완료 체크하기" }).click();
  await page.goto("/home");
  await expect(exp).toHaveText("EXP 030/300");
  await expect(exp).toHaveAttribute("aria-valuenow", "30");
  expect(await exp.locator("i").evaluate((e) => getComputedStyle(e).backgroundColor)).toBe(
    "rgb(83, 166, 110)",
  );
  await page.reload();
  await expect(exp).toHaveText("EXP 030/300");
  await page.goto("/quests/meal");
  await expect(page.getByRole("button", { name: "오늘 완료한 퀘스트예요" })).toBeDisabled();
});

test("level-up carries surplus EXP and all existing level labels agree", async ({ page }) => {
  await page.goto("/home");
  await page.evaluate(() => {
    const key = "rexrun-demo-game-v1";
    const game = JSON.parse(localStorage.getItem(key)!);
    localStorage.setItem(key, JSON.stringify({ ...game, experience: 290, completed: [] }));
  });
  await page.goto("/quests/medicine");
  await page.getByRole("button", { name: "완료 체크하기" }).click();
  await page.goto("/home");
  await expect(page.locator(".level")).toContainText("Lv.13");
  await expect(page.getByRole("progressbar", { name: "레벨 경험치" })).toHaveText("EXP 010/300");
  await page.goto("/me");
  await expect(page.locator(".member-card")).toContainText("Lv.13");
  await page.goto("/buff");
  await expect(page.locator(".buff-scene")).toContainText("Lv.13");
});
