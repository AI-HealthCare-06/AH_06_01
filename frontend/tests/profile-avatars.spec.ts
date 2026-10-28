import { expect, test } from "@playwright/test";

test("all ten matching-gender avatars can be selected, persist across tabs and reload, and reset on logout", async ({
  page,
}) => {
  await page.goto("/me");
  const trigger = page.getByRole("button", { name: "프로필 이미지 변경", exact: true });
  await trigger.click();
  const dialog = page.getByRole("dialog", { name: "프로필 이미지 선택" });
  const choices = dialog.locator(".profile-avatar-grid button");
  await expect(choices).toHaveCount(10);
  test.setTimeout(90_000);
  for (const choice of await choices.all()) {
    // Decode each lazy thumbnail explicitly, including offscreen choices.
    await choice.locator("img").evaluate(async (node: HTMLImageElement) => {
      node.loading = "eager";
      await node.decode();
    });
    await choice.click();
    await expect(choice).toHaveAttribute("aria-pressed", "true");
    const source = await choice.locator("img").getAttribute("src");
    await expect(dialog.locator(".profile-avatar img")).toHaveAttribute("src", source!);
    await expect
      .poll(() => choice.locator("img").evaluate((node) => (node as HTMLImageElement).naturalWidth))
      .toBeGreaterThan(0);
  }
  await dialog.getByRole("button", { name: "여성 08 · 약 63세 프로필 선택", exact: true }).click();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
  for (const route of ["home", "character", "shop", "dashboard", "camera", "quests", "me"]) {
    await page.goto(`/${route}`);
    await expect(page.locator(".profile-avatar img")).toHaveAttribute(
      "src",
      "/assets/profile-avatars/female-08-age-63.png",
    );
  }
  await page.reload();
  await expect(page.locator(".profile-avatar")).toHaveAttribute("data-avatar", "female-08");
  await trigger.click();
  await expect(
    dialog.getByRole("button", { name: "여성 08 · 약 63세 프로필 선택", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await dialog.getByRole("button", { name: "기본 아바타", exact: true }).click();
  await expect(dialog.locator(".profile-avatar")).toHaveAttribute("data-avatar", "default");
  expect(await page.evaluate(() => localStorage.getItem("rexrun-profile-avatar-id"))).toBeNull();
  await dialog.getByRole("button", { name: "여성 01 · 약 10세 프로필 선택", exact: true }).click();
  await dialog.getByRole("button", { name: "닫기", exact: true }).click();
  await page.getByRole("button", { name: "로그아웃", exact: true }).click();
  await expect(page).toHaveURL(/\/login$/);
  expect(await page.evaluate(() => localStorage.getItem("rexrun-profile-avatar-id"))).toBeNull();
});

test("unknown stored avatar IDs fall back safely and the picker fits small screens", async ({
  page,
}) => {
  await page.addInitScript(() =>
    localStorage.setItem("rexrun-profile-avatar-id", "../../private.png"),
  );
  for (const width of [320, 390, 526]) {
    await page.setViewportSize({ width, height: 640 });
    await page.goto("/me");
    await expect(page.locator(".profile-avatar")).toHaveAttribute("data-avatar", "default");
    await page.getByRole("button", { name: "프로필 이미지 변경", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "프로필 이미지 선택" });
    await expect(
      dialog.getByRole("heading", { name: "프로필 이미지 선택", exact: true }),
    ).toBeInViewport();
    await expect(dialog.getByRole("button", { name: "닫기", exact: true })).toBeInViewport();
    for (const button of await dialog.locator(".profile-avatar-grid button").all()) {
      const bounds = (await button.boundingBox())!;
      expect(bounds.width).toBeGreaterThanOrEqual(44);
      expect(bounds.x).toBeGreaterThanOrEqual(0);
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
    }
    expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(
      true,
    );
    await page.keyboard.press("Escape");
  }
});

test("the profile greeting and two actions share one row and skin changes have no popup", async ({
  page,
}) => {
  for (const width of [320, 390, 526, 960]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto("/home");
    const header = page.locator(".greeting");
    const bounds = await header
      .locator(":scope > a, :scope > div, :scope > button")
      .evaluateAll((elements) =>
        elements.map((element) => {
          const rect = element.getBoundingClientRect();
          return {
            x: rect.x,
            right: rect.right,
            middle: rect.top + rect.height / 2,
            width: rect.width,
            height: rect.height,
          };
        }),
      );
    expect(bounds).toHaveLength(4);
    for (let i = 0; i < bounds.length; i++) {
      expect(Math.abs(bounds[i].middle - bounds[0].middle)).toBeLessThan(2);
      if (i) expect(bounds[i].x).toBeGreaterThanOrEqual(bounds[i - 1].right);
      if (i !== 1) {
        expect(bounds[i].width).toBeGreaterThanOrEqual(44);
        expect(bounds[i].height).toBeGreaterThanOrEqual(44);
      }
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.getByRole("link", { name: "Character", exact: true }).click();
    await page.locator(".vault-skin-grid [aria-pressed='true']").press("ArrowRight");
    const art = page.locator(".vault-hero-stage .dinosaur-art");
    await expect(art).toHaveAttribute("data-skin", "desert");
    await expect(page.locator(".notice.visible")).toHaveCount(0);
    await page.getByRole("button", { name: "티라노 오리지널 스킨 선택", exact: true }).click();
    await expect(art).toHaveAttribute("data-skin", "original");
    await expect(page.locator(".notice.visible")).toHaveCount(0);
  }
});
