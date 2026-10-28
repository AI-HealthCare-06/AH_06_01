import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
const model = JSON.parse(
  readFileSync(new URL("./fixtures/quest-analysis-demo.json", import.meta.url), "utf8"),
);

test("public demo entry and exit keep the account namespace separate", async ({ page }) => {
  test.skip(process.env.REXRUN_AUTH_UI !== "1", "Requires the production login entry");
  test.setTimeout(60_000);
  let privateCalls = 0;
  await page.route("**/v1/sync", async (route) => {
    privateCalls++;
    await route.abort();
  });
  await page.route("**/predictions/bp-stage", async (route) => {
    expect(route.request().postDataJSON()).toEqual({ demo_persona: "htn-diabetes-v1" });
    expect(route.request().headers().authorization).toBeUndefined();
    await route.fulfill({ json: model });
  });
  await page.goto("/login");
  await page.evaluate(() =>
    localStorage.setItem("rexrun-cloud-v1:synthetic-account", "cached-account-save-preserved"),
  );
  await page.getByRole("button", { name: "고혈압·당뇨 데모 체험" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByText("DEMO · 고혈압·당뇨 페르소나 / 합성 7일 기록")).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByRole("region", { name: "M1·M2 참고 분석" })).toContainText(
    "확인 항목 1 / 10",
  );
  expect(await page.evaluate(() => localStorage.getItem("rexrun-cloud-v1:synthetic-account"))).toBe(
    "cached-account-save-preserved",
  );
  expect(privateCalls).toBe(0);
  await page.getByRole("button", { name: "데모 나가기" }).click();
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole("button", { name: "고혈압·당뇨 데모 체험" })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem("rexrun-persona-mode"))).toBeNull();
  expect(await page.evaluate(() => localStorage.getItem("rexrun-cloud-v1:synthetic-account"))).toBe(
    "cached-account-save-preserved",
  );
});
