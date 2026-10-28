import { selectPixelOption } from "./helpers/controls";
import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

test.use({ isMobile: true, hasTouch: true, viewport: { width: 412, height: 892 } });

test("a saved disease-free survey reaches the live model and displays its distribution", async ({
  page,
}) => {
  test.skip(
    process.env.REXRUN_LIVE_MODEL !== "1",
    "Requires the deployed adapter and synthetic fixture account",
  );
  test.setTimeout(180000);
  const fixture = JSON.parse(
    readFileSync(resolve("../.cache/deployment/fixtures.private.json"), "utf8"),
  );
  const user = fixture.users[0];
  expect(/^rexrun-synthetic-[a-f0-9]+-[01]@example\.invalid$/.test(user.email)).toBe(true);
  await page.goto("/login");
  await page.getByLabel("이메일", { exact: true }).fill(user.email);
  await page.getByLabel("비밀번호", { exact: true }).fill(user.password);
  await page.getByRole("button", { name: "로그인", exact: true }).click();
  await expect(page).toHaveURL(/\/home$/, { timeout: 35000 });
  await page.goto("/profile?mode=edit");
  const next = async (title: string) =>
    page.getByRole("button", { name: `다음: ${title}`, exact: true }).click();
  await page.getByLabel("나이", { exact: true }).fill("35");
  await selectPixelOption(page.getByLabel("성별", { exact: true }), "male");
  await page.getByLabel("키", { exact: true }).fill("175");
  await page.getByLabel("몸무게", { exact: true }).fill("70");
  await next("혈압 / 공복 혈당");
  await page.getByLabel("혈압 모름", { exact: true }).check();
  await page.getByLabel("공복 혈당 모름", { exact: true }).check();
  await next("앓고 있는 지병");
  await page
    .getByRole("radiogroup", { name: "지병·기저질환 여부" })
    .getByRole("radio", { name: "없음", exact: true })
    .check();
  await next("그 밖의 만성질환");
  await next("특수 이력 / 치료 상태");
  await selectPixelOption(page.getByLabel("고혈압 진단·치료 상태"), "none");
  await next("복용 중인 약과 시간");
  await next("생활습관");
  await page.getByLabel("주당 음주 일수", { exact: true }).fill("2");
  await page.getByLabel("하루 수면 시간", { exact: true }).fill("7");
  await page.getByLabel("주당 활동 시간", { exact: true }).fill("150");
  await next("음주 습관");
  await page.getByLabel("주당 표준잔 수", { exact: true }).fill("");
  await page
    .getByRole("radiogroup", { name: "월 1회 이상 폭음 여부" })
    .getByRole("radio", { name: "없음", exact: true })
    .check();
  await next("추가 분석 정보");
  await page.getByLabel("허리둘레", { exact: true }).fill("");
  await page.getByLabel("안정 시 맥박", { exact: true }).fill("");
  await page.getByLabel("교육 이수 연수", { exact: true }).fill("");
  await next("가족력");
  for (const name of ["고혈압 가족력", "당뇨 가족력"])
    await page
      .getByRole("radiogroup", { name })
      .getByRole("radio", { name: "없음", exact: true })
      .check();
  await next("확인하고 완료");
  await page.locator(".profile-form label.privacy-note input").check();
  await page.getByRole("button", { name: "변경 저장하고 홈으로", exact: true }).click();
  await expect(page).toHaveURL(/\/home$/);
  await page.goto("/me");
  await expect(page.locator(".cloud-status")).toContainText("서버·DB 저장 확인 완료", {
    timeout: 35000,
  });
  await page.goto("/dashboard/report");
  const incompleteCard = page.getByLabel("생활습관 기반 혈압 단계 참고");
  await expect(incompleteCard).toContainText("추가 입력이 필요해요", { timeout: 35000 });
  await expect(incompleteCard).toContainText(
    "추가할 수 있는 정보: 허리둘레 · 주당 표준잔 수 · 공복 혈당 · 안정 시 맥박 · 교육 이수 연수",
  );
  await incompleteCard.screenshot({ path: "test-results/profile-none-live-missing.png" });
  await incompleteCard.getByRole("link", { name: "건강 정보 확인하기" }).click();
  await expect(page).toHaveURL(/section=analysis/);
  await expect(page.getByRole("heading", { name: "추가 분석 정보", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "이전", exact: true }).click();
  await page.getByLabel("주당 표준잔 수", { exact: true }).fill("8");
  await next("추가 분석 정보");
  await page.getByLabel("허리둘레", { exact: true }).fill("32.5");
  await page.getByLabel("안정 시 맥박", { exact: true }).fill("65");
  await page.getByLabel("교육 이수 연수", { exact: true }).fill("12");
  await page.screenshot({ path: "test-results/profile-reference-survey-s25.png" });
  await next("가족력");
  await next("확인하고 완료");
  await page.locator(".profile-form label.privacy-note input").check();
  await page.getByRole("button", { name: "변경 저장하고 홈으로", exact: true }).click();
  await expect(page).toHaveURL(/\/home$/);
  await page.goto("/me");
  await expect(page.locator(".cloud-status")).toContainText("서버·DB 저장 확인 완료", {
    timeout: 35000,
  });
  const saved = await page.evaluate(async () => {
    const path = "/src/cloud/client.ts";
    const { cloudApi } = await import(path);
    const remote = await cloudApi("/v1/me");
    const details = remote.health_profile.details;
    return {
      status: details.conditionStatus,
      conditions: details.conditions,
      family: details.hypertensionFamily,
      waist: details.waistCm,
      hr: details.restingHeartRate,
      education: details.educationYears,
      alcohol: details.alcoholWeek,
    };
  });
  expect(saved).toEqual({
    status: "none",
    conditions: [],
    family: false,
    waist: 82.55,
    hr: 65,
    education: 12,
    alcohol: 8,
  });
  await page.goto("/dashboard/report");
  const card = page.getByLabel("생활습관 기반 혈압 단계 참고");
  await expect(card).toContainText("일부 정보가 없어", { timeout: 35000 });
  await expect(card.getByLabel("혈압 단계별 참고 분포")).toBeVisible();
  await expect(card).not.toContainText("추가 입력이 필요해요");
  await card.screenshot({ path: "test-results/profile-none-live-result.png" });
  await page.goto("/me");
  await page.getByRole("button", { name: "로그아웃", exact: true }).click();
  await expect(page).toHaveURL(/\/login$/, { timeout: 20000 });
});
