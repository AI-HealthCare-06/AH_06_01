import { expect, test } from "@playwright/test";

test("every quest shows its actual progress and completion updates the bar", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto("/quests");
    await page.evaluate(() => document.fonts.ready);
    const bars = page.getByRole("progressbar");
    await expect(bars).toHaveCount(5);
    for (const [index, expected] of [100, 100, 54, 0, 88].entries()) {
      await expect(bars.nth(index)).toHaveAttribute("aria-valuenow", String(expected));
      const ratio = await bars
        .nth(index)
        .evaluate(
          (element) =>
            (element.firstElementChild!.getBoundingClientRect().width /
              element.getBoundingClientRect().width) *
            100,
        );
      expect(ratio).toBeCloseTo(expected, 0);
    }
    await expect(page.locator(".quest-row .pixel-check")).toHaveCount(2);
    for (const row of await page.locator(".quest-row").all()) {
      const bounds = (await row.boundingBox())!;
      const checkbox = (await row.locator(".checkbox").boundingBox())!;
      expect(checkbox.x - bounds.x).toBeCloseTo(10, 0);
      expect(
        await row
          .locator(".quest-row-copy")
          .evaluate((element) => element.scrollWidth <= element.clientWidth),
      ).toBe(true);
    }
  }
  await page.getByRole("link", { name: /6,000걸음 걷기/ }).click();
  await page.getByRole("button", { name: "완료 체크하기" }).click();
  await expect(page).toHaveURL(/\/reward$/);
  await page.goto("/quests");
  await expect(page.getByRole("progressbar", { name: "6,000걸음 걷기 진행도" })).toHaveAttribute(
    "aria-valuenow",
    "100",
  );
  await expect(page.locator(".quest-row .pixel-check")).toHaveCount(3);
});

test("numbers count up on tab entry and animate new rewards without changing their real value", async ({
  page,
}) => {
  await page.clock.install({ time: new Date("2026-09-28T03:00:00Z") });
  await page.clock.pauseAt(new Date("2026-09-28T03:00:01Z"));
  await page.goto("/shop");
  const visual = page.locator(".wallet-balance .number-visual");
  await expect(page.locator(".wallet-balance > strong")).toHaveText("1,280");
  await expect(visual).toHaveAttribute("data-value", "0");
  await page.clock.runFor(350);
  const intermediate = Number((await visual.getAttribute("data-value"))!.replaceAll(",", ""));
  expect(intermediate).toBeGreaterThan(0);
  expect(intermediate).toBeLessThan(1280);
  await page.clock.runFor(500);
  await expect(visual).toHaveAttribute("data-value", "1,280");
  const before = await page.evaluate(() => localStorage.getItem("rexrun-demo-game-v1"));
  await page.getByRole("link", { name: "Home", exact: true }).click();
  await page.getByRole("link", { name: "Shop", exact: true }).click();
  await expect(visual).toHaveAttribute("data-value", "0");
  await page.clock.runFor(800);
  await expect(visual).toHaveAttribute("data-value", "1,280");
  expect(await page.evaluate(() => localStorage.getItem("rexrun-demo-game-v1"))).toBe(before);
  await page.locator(".daily-bonus").click();
  await expect(page.locator(".wallet-balance > strong")).toHaveText("1,290");
  await expect(visual).toHaveAttribute("data-value", "1,280");
  await page.clock.runFor(800);
  await expect(visual).toHaveAttribute("data-value", "1,290");
});

test("charts and progress bars replay when returning to their tab", async ({ page }) => {
  await page.goto("/home");
  await expect(page.locator(".radar-series")).toHaveCount(2);
  await page
    .locator(".radar-series")
    .first()
    .evaluate((element) => {
      Reflect.set(window, "previousRadar", element);
      Reflect.set(window, "previousRadarAnimation", element.getAnimations()[0]);
    });
  await page.getByRole("link", { name: "Quest", exact: true }).click();
  await page
    .locator(".quest-row-progress .metric-fill")
    .first()
    .evaluate((element) => {
      Reflect.set(window, "previousProgress", element);
      Reflect.set(window, "previousProgressAnimation", element.getAnimations()[0]);
    });
  await page.getByRole("link", { name: "Home", exact: true }).click();
  expect(
    await page
      .locator(".radar-series")
      .first()
      .evaluate((element) => {
        const animation = element.getAnimations()[0];
        return (
          element !== Reflect.get(window, "previousRadar") &&
          !!animation &&
          animation !== Reflect.get(window, "previousRadarAnimation") &&
          animation.effect!.getTiming().iterations === 1
        );
      }),
  ).toBe(true);
  await page.getByRole("link", { name: "Quest", exact: true }).click();
  expect(
    await page
      .locator(".quest-row-progress .metric-fill")
      .first()
      .evaluate((element) => {
        const animation = element.getAnimations()[0];
        return (
          element !== Reflect.get(window, "previousProgress") &&
          !!animation &&
          animation !== Reflect.get(window, "previousProgressAnimation") &&
          animation.effect!.getTiming().iterations === 1
        );
      }),
  ).toBe(true);
  await page.getByRole("link", { name: "Dashboard", exact: true }).click();
  await expect(page.locator(".impact-bars .metric-fill")).toHaveCount(6);
  expect(
    await page
      .locator(".impact-bars .metric-fill")
      .evaluateAll((elements) => elements.every((element) => element.getAnimations().length > 0)),
  ).toBe(true);
});

test("reduced motion immediately shows final metrics and stops entry animations", async ({
  page,
}) => {
  await page.clock.install({ time: new Date("2026-09-28T03:00:00Z") });
  await page.clock.pauseAt(new Date("2026-09-28T03:00:01Z"));
  await page.goto("/shop");
  await expect(page.locator(".wallet-balance .number-visual")).toHaveAttribute("data-value", "0");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(page.locator(".wallet-balance .number-visual")).toHaveAttribute(
    "data-value",
    "1,280",
  );
  // Resume the test clock so the dashboard's async query notifications can run.
  await page.clock.resume();
  for (const route of ["home", "quests", "dashboard", "shop"]) {
    await page.goto(`/${route}`);
    await page.locator(".animated-number").first().waitFor();
    const animations = await page
      .locator(".metric-fill, .radar-series")
      .evaluateAll((elements) => elements.flatMap((element) => element.getAnimations()).length);
    expect(animations, route).toBe(0);
    const displayed = await page
      .locator(".animated-number")
      .evaluateAll((elements) =>
        elements.every(
          (element) =>
            getComputedStyle(element.querySelector(".number-final")!).opacity === "1" &&
            getComputedStyle(element.querySelector(".number-visual")!).display === "none",
        ),
      );
    expect(displayed, route).toBe(true);
  }
});
