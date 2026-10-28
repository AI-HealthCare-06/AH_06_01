import { selectPixelOption } from "./helpers/controls";
import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("rexrun-onboarding-completed", "true"));
});

test.use({ isMobile: true, hasTouch: true, viewport: { width: 412, height: 892 } });

test("none and zero survive the paged survey while genuinely unknown values remain null", async ({
  page,
}) => {
  await page.goto("/profile");
  const next = async (title: string) =>
    page.getByRole("button", { name: `다음: ${title}`, exact: true }).click();
  await next("혈압 / 공복 혈당");
  await page.getByLabel("혈압 모름", { exact: true }).check();
  await page.getByLabel("공복 혈당 모름", { exact: true }).check();
  await next("앓고 있는 지병");
  await page
    .getByRole("radiogroup", { name: "지병·기저질환 여부" })
    .getByRole("radio", { name: "없음", exact: true })
    .check();
  await next("그 밖의 만성질환");
  await expect(
    page
      .getByRole("radiogroup", { name: "지병·기저질환 여부" })
      .getByRole("radio", { name: "없음", exact: true }),
  ).toBeChecked();
  await next("특수 이력 / 치료 상태");
  await selectPixelOption(page.getByLabel("고혈압 진단·치료 상태", { exact: true }), "none");
  await next("복용 중인 약과 시간");
  await next("생활습관");
  await page.getByLabel("주당 음주 일수", { exact: true }).fill("2");
  await page.getByLabel("하루 수면 시간", { exact: true }).fill("7");
  await page.getByLabel("주당 활동 시간", { exact: true }).fill("150");
  await next("음주 습관");
  await page.getByLabel("주당 표준잔 수", { exact: true }).fill("8");
  await page
    .getByRole("radiogroup", { name: "월 1회 이상 폭음 여부" })
    .getByRole("radio", { name: "없음", exact: true })
    .check();
  await next("추가 분석 정보");
  await page.getByLabel("허리둘레", { exact: true }).fill("32.5");
  await page.getByLabel("교육 이수 연수", { exact: true }).fill("0");
  await next("가족력");
  for (const name of ["고혈압 가족력", "당뇨 가족력"])
    await page
      .getByRole("radiogroup", { name })
      .getByRole("radio", { name: "없음", exact: true })
      .check();
  await next("확인하고 완료");
  await expect(page.locator(".survey-confirmation")).toContainText("없음");
  await page.getByRole("button", { name: "변경 저장하고 홈으로", exact: true }).click();
  const profile = await page.evaluate(async () => {
    const path = "/src/stores/profile-store.ts";
    const { useProfileStore } = await import(path);
    return useProfileStore.getState().profile;
  });
  expect(profile).toMatchObject({
    conditionStatus: "none",
    conditions: [],
    hypertensionFamily: false,
    diabetesFamily: false,
    bloodPressure: null,
    glucose: null,
    alcoholWeek: 8,
    bingeMonthly: false,
    waistCm: 82.55,
    restingHeartRate: null,
    educationYears: 0,
  });
});
