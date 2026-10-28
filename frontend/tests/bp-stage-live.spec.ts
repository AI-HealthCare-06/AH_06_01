import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

test("deployed dashboard displays the caller's computed distribution and BP exclusion", async ({
  page,
}) => {
  test.skip(
    process.env.REXRUN_LIVE_MODEL !== "1",
    "Requires generated synthetic fixtures and the deployed model",
  );
  test.setTimeout(150_000);
  const fixture = JSON.parse(
    readFileSync(resolve("../.cache/deployment/fixtures.private.json"), "utf8"),
  );
  const [a, b] = fixture.users as Array<{ email: string; password: string }>;
  expect(
    [a, b].every(
      (u) => u.email.startsWith("rexrun-synthetic-") && u.email.endsWith("@example.invalid"),
    ),
  ).toBe(true);
  const origin = "https://d4vy5vn0lhbgi.cloudfront.net";
  for (const [index, user] of [a, b].entries()) {
    await page.goto(`${origin}/login`);
    await page.getByLabel("이메일", { exact: true }).fill(user.email);
    await page.getByLabel("비밀번호", { exact: true }).fill(user.password);
    await page.getByRole("button", { name: "로그인", exact: true }).click();
    await expect(page).toHaveURL(/\/home$/, { timeout: 35_000 });
    await page.goto(`${origin}/me`);
    const cloud = page.locator(".cloud-status");
    await cloud.getByRole("checkbox").check();
    await expect(cloud).toContainText("서버·DB 저장 확인 완료", { timeout: 30_000 });
    await page.goto(`${origin}/dashboard/report`);
    const card = page.getByLabel("생활습관 기반 혈압 단계 참고");
    if (index === 0) {
      await expect(card).toContainText("일부 정보가 없어", { timeout: 35_000 });
      await expect(card.getByLabel("혈압 단계별 참고 분포")).toBeVisible();
      await card.screenshot({ path: "test-results/model-stage-live-mobile.png" });
    } else {
      await expect(card).toContainText("혈압 기록을 기준으로 확인해요", { timeout: 35_000 });
      await expect(card.getByLabel("혈압 단계별 참고 분포")).toHaveCount(0);
    }
    await page.goto(`${origin}/me`);
    await page.getByRole("button", { name: "로그아웃", exact: true }).click();
    await expect(page).toHaveURL(/\/login$/, { timeout: 20_000 });
  }
});
