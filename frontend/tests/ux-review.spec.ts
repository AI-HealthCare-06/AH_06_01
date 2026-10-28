import { expect, test } from "@playwright/test";
import { selectPixelOption } from "./helpers/controls";

test("settings list stays compact and opens full details explicitly", async ({ page }) => {
  await page.goto("/tests/fixtures/settings.html");
  const update = page.getByRole("button", { name: /^앱 업데이트/ });
  await expect(update).toBeVisible();
  await expect(page.getByRole("button", { name: "업데이트 확인", exact: true })).toHaveCount(0);
  await update.click();
  await expect(page.getByRole("dialog", { name: "앱 업데이트", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "업데이트 확인", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "닫기", exact: true }).click();
  await expect(update).toBeFocused();
  for (const width of [320, 390, 430]) {
    await page.setViewportSize({ width, height: 700 });
    expect((await update.boundingBox())!.height).toBeLessThan(110);
  }
});

test("pixel dropdown supports keyboard selection without navigation or clipping", async ({
  page,
}) => {
  await page.goto("/dashboard/report");

  const control = page.getByRole("combobox", { name: "건강 변화 조회 기간" });
  await control.focus();
  await control.press("ArrowDown");
  const list = page.getByRole("listbox").filter({ visible: true });
  await expect(list).toBeVisible();
  await control.press("Home");
  await control.press("Enter");
  await expect(list).toHaveCount(0);
  await expect(page).toHaveURL(/period=day/);
  await selectPixelOption(control, "month");
  await expect(page).toHaveURL(/period=month/);
});

test("shop uses 1000 Gold per RP and Coupang reference prices without changing owned items", async ({
  page,
}) => {
  await page.goto("/shop");
  await page.getByRole("button", { name: "전환 ⇄", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("1,000 GOLD → 1 RP");
  await page.getByRole("button", { name: "닫기", exact: true }).click();
  await expect(page.locator(".product-grid > .product")).toHaveCount(6);
  const last = page.locator(".product-grid > .product").last();
  await last.scrollIntoViewIfNeeded();
  await expect(last).toBeInViewport();
  const vitamin = page.getByRole("button", { name: /종근당건강 원데이21/ });
  await expect(vitamin).toContainText("10,350 RP");
  await vitamin.click();
  const detail = page.getByRole("dialog");
  await expect(detail).toContainText("11,500원");
  await expect(detail.getByRole("link", { name: /쿠팡에서/ })).toHaveAttribute(
    "href",
    /coupang.com/,
  );
});

test("main pages fit phone widths with spacing around cards", async ({ page }) => {
  for (const path of ["/quests", "/medications", "/me", "/shop", "/dashboard"]) {
    await page.goto(path);
    for (const width of [320, 390, 430]) {
      await page.setViewportSize({ width, height: 844 });
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1),
        path + " at " + width,
      ).toBe(false);
    }
  }
});

test("medication entry uses everyday terms and keeps supplement registration", async ({ page }) => {
  await page.goto("/medications");
  await page.getByRole("button", { name: "+ 약 / 영양제 등록", exact: true }).click();
  await page.getByLabel("약 / 영양제 이름", { exact: true }).fill("테스트 영양제");
  await page.getByRole("radio", { name: "영양제", exact: true }).check();
  await expect(page.getByText("ARB / ACE 억제제", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "항목 저장", exact: true }).click();
  await expect(page.locator(".medication-list")).toContainText("테스트 영양제");
});
test("cloud synchronization summary opens consent details without changing consent", async ({
  page,
}) => {
  test.skip(
    process.env.REXRUN_AUTH_UI !== "1",
    "Cloud UI fixture runs on its configured auth port",
  );
  await page.goto("/tests/fixtures/settings.html");
  const summary = page.getByRole("button", { name: /^계정 데이터 동기화/ });
  await expect(summary).toBeVisible();
  expect((await summary.boundingBox())!.height).toBeLessThan(110);
  await expect(page.getByRole("checkbox")).toHaveCount(0);
  await summary.click();
  const dialog = page.getByRole("dialog", { name: "계정 데이터 동기화", exact: true });
  await expect(dialog.getByRole("checkbox")).not.toBeChecked();
  await expect(dialog).toContainText("건강 프로필·복약·걸음 수·퀘스트");
  await page.getByRole("button", { name: "닫기", exact: true }).click();
  await expect(summary).toBeFocused();
});
