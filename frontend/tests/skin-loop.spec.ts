import { expect, test } from "@playwright/test";

async function centered(page: import("@playwright/test").Page) {
  await expect
    .poll(() =>
      page.locator(".vault-skin-grid").evaluate((region) => {
        const selected = region.querySelector('[aria-pressed="true"]')!.getBoundingClientRect();
        const bounds = region.getBoundingClientRect();
        return Math.abs(selected.left + selected.width / 2 - bounds.left - region.clientWidth / 2);
      }),
    )
    .toBeLessThan(2);
}

test("the first and last skins remain adjacent through repeated rotations and wheel swipes", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/character");
  const region = page.locator(".vault-skin-grid");
  const next = { click: () => region.locator("[aria-pressed='true']").press("ArrowRight") };
  const previous = { click: () => region.locator("[aria-pressed='true']").press("ArrowLeft") };
  const skinIds = [
    "original",
    "desert",
    "snow",
    "volcano",
    "forest",
    "ocean",
    "sunset",
    "violet",
    "gold",
  ];
  for (let i = 1; i <= 18; i++) {
    await next.click();
    await centered(page);
    const current = i % 9;
    expect(
      await region.evaluate((element) => {
        const selected = element.querySelector('[aria-pressed="true"]')!;
        return [
          selected.previousElementSibling!.getAttribute("data-skin-id"),
          selected.getAttribute("data-skin-id"),
          selected.nextElementSibling!.getAttribute("data-skin-id"),
        ];
      }),
    ).toEqual([skinIds[(current + 8) % 9], skinIds[current], skinIds[(current + 1) % 9]]);
  }
  for (let i = 0; i < 18; i++) {
    await previous.click();
    await centered(page);
  }
  await expect(page.getByLabel("현재 스킨")).toContainText("SKIN 1 / 9");
  await expect(page.getByRole("button", { name: /^티라노 .+ 스킨 선택$/ })).toHaveCount(9);
  await previous.click();
  await centered(page);
  const step = await region.evaluate((element) => {
    const selected = element.querySelector('[aria-pressed="true"]')!;
    return (
      (selected.nextElementSibling as HTMLElement).offsetLeft - (selected as HTMLElement).offsetLeft
    );
  });
  await region.hover();
  await page.mouse.wheel(step, 0);
  await expect(page.getByLabel("현재 스킨")).toContainText("SKIN 1 / 9");
  await centered(page);
  await page.mouse.wheel(-step, 0);
  await expect(page.getByLabel("현재 스킨")).toContainText("SKIN 9 / 9");
  await centered(page);
});

test("crossing either end animates one card in the requested direction without a rewind", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto("/character");
  await page.getByRole("button", { name: "티라노 황금빛 용사 스킨 선택", exact: true }).click();
  await centered(page);
  const region = page.locator(".vault-skin-grid");
  for (const [control, direction, index] of [
    ["다음 스킨", 1, 1],
    ["이전 스킨", -1, 9],
  ] as const) {
    const start = await region.evaluate((element) => element.scrollLeft);
    await region.evaluate((element) => {
      const samples: number[] = [];
      const record = () => samples.push(element.scrollLeft);
      Reflect.set(window, "skinLoopSamples", samples);
      Reflect.set(window, "skinLoopRecord", record);
      element.addEventListener("scroll", record);
    });
    await region
      .locator("[aria-pressed='true']")
      .press(control === "다음 스킨" ? "ArrowRight" : "ArrowLeft");
    await expect(page.getByLabel("현재 스킨")).toContainText(`SKIN ${index} / 9`);
    await centered(page);
    const samples = await region.evaluate((element) => {
      element.removeEventListener("scroll", Reflect.get(window, "skinLoopRecord"));
      return Reflect.get(window, "skinLoopSamples") as number[];
    });
    const movement = samples
      .map((value) => (value - start) * direction)
      .filter((value) => value >= 0 && value < 100);
    expect(Math.max(...movement)).toBeGreaterThan(40);
    expect(Math.max(...movement)).toBeLessThanOrEqual(82);
  }
});
