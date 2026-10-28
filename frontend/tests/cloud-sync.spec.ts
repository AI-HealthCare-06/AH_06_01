import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Opt-in integration test. Credentials are generated synthetic fixtures in an ignored file.
test("deployed app retries offline progress, restores it and isolates account changes", async ({
  page,
  context,
}) => {
  test.skip(
    process.env.REXRUN_LIVE_CLOUD !== "1",
    "Requires the deployed test API and synthetic accounts",
  );
  test.setTimeout(120_000);
  const fixture = JSON.parse(
    readFileSync(resolve("../.cache/deployment/fixtures.private.json"), "utf8"),
  );
  const [a, b] = fixture.users as Array<{ id: string; email: string; password: string }>;
  const origin = "https://d4vy5vn0lhbgi.cloudfront.net";
  const login = async (user: typeof a) => {
    await page.goto(`${origin}/login`);
    await page.getByLabel("이메일", { exact: true }).fill(user.email);
    await page.getByLabel("비밀번호", { exact: true }).fill(user.password);
    await page.getByRole("button", { name: "로그인", exact: true }).click();
  };
  await login(a);
  await expect(page).toHaveURL(/\/home$/, { timeout: 30_000 });
  await page.goto(`${origin}/me`);
  const cloud = page.locator(".cloud-status");
  await expect(cloud).toContainText(a.email);
  await cloud.getByRole("checkbox").check();
  await expect(cloud).toContainText("서버·DB 저장 확인 완료", { timeout: 30_000 });
  await page.goto(`${origin}/quests/meal`);
  await context.setOffline(true);
  await page.getByRole("button", { name: "완료 체크하기", exact: true }).click();
  await expect(page).toHaveURL(/\/reward$/);
  const queueLength = () =>
    page.evaluate(
      (uid) =>
        JSON.parse(localStorage.getItem(`rexrun-cloud-v1:${uid}`) ?? "{}").queue?.length ?? 0,
      a.id,
    );
  await expect.poll(queueLength).toBeGreaterThan(0);
  await context.setOffline(false);
  await expect.poll(queueLength, { timeout: 30_000 }).toBe(0);
  await page.goto(`${origin}/quests/meal`);
  await page.reload();
  await expect(
    page.getByRole("button", { name: "오늘 완료한 퀘스트예요", exact: true }),
  ).toBeDisabled();
  await page.goto(`${origin}/me`);
  await page.getByRole("button", { name: "로그아웃", exact: true }).click();
  await expect(page).toHaveURL(/\/login$/);
  await login(b);
  await expect(page).toHaveURL(/\/profile$/, { timeout: 30_000 });
  await expect(page.getByRole("textbox", { name: "이름", exact: true })).not.toHaveValue(
    "Synthetic Test",
  );
  await page.goto(`${origin}/medications`);
  await expect(page.getByText("Synthetic medication", { exact: true })).toHaveCount(0);
});
