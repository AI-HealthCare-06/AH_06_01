import { expect, test } from "@playwright/test";

test("health dashboard has one view and keeps character selection in the main navigation", async ({
  page,
}) => {
  await page.goto("/dashboard");
  await expect(page.getByRole("navigation", { name: "대시보드 선택" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "캐릭터 대시보드" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "혈압 기록과 판정" })).toBeVisible();
  await expect(page.locator(".health-score")).toBeVisible();
  await expect(page.getByLabel("주간 달력", { exact: true })).toBeVisible();
  await page
    .getByRole("navigation", { name: "주요 메뉴" })
    .getByRole("link", { name: "Character", exact: true })
    .click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByLabel("공룡 보관소", { exact: true })).toBeVisible();
  await expect(page.locator('a[href^="/dashboard/character"]')).toHaveCount(0);
  await expect(page.getByLabel("선택한 공룡 전투 능력치")).toHaveCount(0);
});

test("old character dashboard URLs preserve dates, game records, sign-in and medication data", async ({
  page,
}) => {
  await page.clock.install({ time: new Date("2026-10-22T03:00:00Z") });
  await page.clock.pauseAt(new Date("2026-10-22T03:00:01Z"));
  await page.addInitScript(() => {
    if (localStorage.getItem("rexrun-demo-session-active") === null)
      localStorage.setItem("rexrun-demo-session-active", "true");
    if (localStorage.getItem("rexrun-medications-v1") === null)
      localStorage.setItem(
        "rexrun-medications-v1",
        JSON.stringify({
          medications: [
            {
              id: "synthetic-retained",
              name: "Synthetic retained medicine",
              dose: "QA only",
              times: ["08:00", "18:00"],
              active: true,
              condition: "",
              drugClass: "other",
            },
          ],
          taken: { "2026-10-22|synthetic-retained|08:00": true },
          notificationsEnabled: false,
        }),
      );
  });
  await page.goto("/character");
  await page.getByRole("button", { name: "스테고 선택", exact: true }).click();
  const before = await page.evaluate(() => ({
    game: localStorage.getItem("rexrun-demo-game-v1"),
    session: localStorage.getItem("rexrun-demo-session-active"),
    medication: localStorage.getItem("rexrun-medications-v1"),
  }));
  expect(JSON.parse(before.game!).dinosaur).toBe(3);
  expect(before.session).toBe("true");
  expect(JSON.parse(before.medication!).medications[0].name).toBe("Synthetic retained medicine");
  await page.goto("/dashboard/character?period=month&date=2026-10-10");
  await expect(page).toHaveURL(/\/dashboard\?period=month&date=2026-10-10$/);
  await expect(page.getByRole("combobox", { name: "건강 변화 조회 기간" })).toContainText("월간");
  await expect(page.getByRole("button", { name: "조회 기준 날짜" })).toHaveAttribute(
    "data-date",
    "2026-10-10",
  );
  await page.goto("/dashboard/character/report?period=day&date=2026-10-10");
  await expect(page).toHaveURL(/\/dashboard\/report\?period=day&date=2026-10-10$/);
  await expect(page.getByText("REXRUN · HEALTH REPORT", { exact: true })).toBeVisible();
  await page.getByRole("link", { name: "요약으로 돌아가기" }).click();
  await expect(page).toHaveURL(/\/dashboard\?period=day&date=2026-10-10$/);
  expect(
    await page.evaluate(() => ({
      game: localStorage.getItem("rexrun-demo-game-v1"),
      session: localStorage.getItem("rexrun-demo-session-active"),
      medication: localStorage.getItem("rexrun-medications-v1"),
    })),
  ).toEqual(before);
});

test("home radar opens the current health dashboard", async ({ page }) => {
  await page.goto("/home");
  await page.locator(".radar-card").click();
  await expect(page).toHaveURL(/\/character$/);
  await expect(page.locator(".dashboard-summary")).toBeVisible();
});
