import { test, expect } from "@playwright/test";
const sample = {
  stage_probs: { normal: 0.1744, elevated: 0.0901, prehtn: 0.4187, htn: 0.3168 },
  stage_top: "prehtn",
  risk_level: "prehtn",
  reason_codes: ["family_htn"],
  data_quality: "partial",
  model_version: "M1-20261020_150607-nested__base",
  feature_version: "1.2.0",
};
test.beforeEach(async ({ page }) => {
  test.skip(process.env.REXRUN_AUTH_UI !== "1", "Requires cloud-enabled local fixture");
  await page.addInitScript(() => {
    const exp = Math.floor(Date.now() / 1000) + 3600;
    const payload = btoa(
      JSON.stringify({ sub: "00000000-0000-4000-8000-000000000001", exp, role: "authenticated" }),
    );
    localStorage.setItem(
      "sb-bjyanmywcclymklgcrhi-auth-token",
      JSON.stringify({
        access_token: `eyJhbGciOiJIUzI1NiJ9.${payload}.synthetic`,
        refresh_token: "synthetic-only",
        expires_at: exp,
        expires_in: 3600,
        token_type: "bearer",
        user: { id: "00000000-0000-4000-8000-000000000001" },
      }),
    );
  });
});
test("renders real contract distributions and hides the previous account result immediately", async ({
  page,
}) => {
  let calls = 0;
  await page.route("**/v1/predictions/bp-stage", async (route) => {
    calls++;
    expect(route.request().postDataJSON()).toEqual({});
    expect(route.request().headers().authorization).toContain("Bearer ");
    await route.fulfill({ json: sample });
  });
  await page.goto("/tests/fixtures/bp-stage.html");
  await expect(page.getByText("전단계 참고권", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("41.9%", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: "test-results/model-stage-mobile.png", fullPage: true });
  await page.getByRole("button", { name: "게임 저장 대기" }).click();
  await expect(page.getByLabel("혈압 단계별 참고 분포")).toBeVisible();
  await page.getByRole("button", { name: "다른 계정으로 전환" }).click();
  await expect(page.getByLabel("혈압 단계별 참고 분포")).toHaveCount(0);
  expect(calls).toBe(1);
});
test("keeps domain refusal score-free and clears output on consent withdrawal", async ({
  page,
}) => {
  await page.route("**/v1/predictions/bp-stage", (route) =>
    route.fulfill({
      json: {
        ...sample,
        stage_probs: null,
        stage_top: null,
        risk_level: null,
        reason_codes: [],
        data_quality: "not_applicable",
      },
    }),
  );
  await page.goto("/tests/fixtures/bp-stage.html");
  await expect(page.getByText("혈압 기록을 기준으로 확인해요", { exact: true })).toBeVisible();
  await expect(page.getByLabel("혈압 단계별 참고 분포")).toHaveCount(0);
  await page.getByRole("button", { name: "서버 저장 동의 철회" }).click();
  await expect(page.getByText("서버 저장 동의 후 분석할 수 있어요", { exact: true })).toBeVisible();
  await expect(page.getByText("혈압 기록을 기준으로 확인해요", { exact: true })).toHaveCount(0);
});

test("insufficient input explains the actual gaps and links to the relevant survey page", async ({
  page,
}) => {
  await page.route("**/v1/predictions/bp-stage", (route) =>
    route.fulfill({
      json: {
        ...sample,
        stage_probs: null,
        stage_top: null,
        risk_level: null,
        reason_codes: [],
        data_quality: "insufficient",
        problems: "missing_count_high",
        missing_inputs: ["waist_cm", "alcohol_week", "resting_hr"],
      },
    }),
  );
  await page.goto("/tests/fixtures/bp-stage.html");
  await expect(page.getByText("추가 입력이 필요해요", { exact: true })).toBeVisible();
  await expect(page.getByText(/추가할 수 있는 정보:/)).toContainText(
    "허리둘레 · 주당 표준잔 수 · 안정 시 맥박",
  );
  await expect(page.getByRole("link", { name: "건강 정보 확인하기" })).toHaveAttribute(
    "href",
    "/profile?mode=edit&section=analysis",
  );
});
