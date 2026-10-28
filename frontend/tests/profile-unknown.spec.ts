import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("rexrun-onboarding-completed", "true"));
});

async function measurements(page: import("@playwright/test").Page) {
  await page.getByRole("button", { name: "다음: 혈압 / 공복 혈당" }).click();
}
async function habits(page: import("@playwright/test").Page) {
  await page.getByRole("button", { name: "다음: 앓고 있는 지병" }).click();
  for (const title of [
    "그 밖의 만성질환",
    "특수 이력 / 치료 상태",
    "복용 중인 약과 시간",
    "생활습관",
  ]) {
    await page.getByRole("button", { name: `다음: ${title}`, exact: true }).click();
  }
}
async function family(page: import("@playwright/test").Page) {
  for (const title of ["음주 습관", "추가 분석 정보", "가족력"]) {
    await page.getByRole("button", { name: `다음: ${title}`, exact: true }).click();
  }
}
async function finish(page: import("@playwright/test").Page) {
  await family(page);
  await page.getByRole("button", { name: "다음: 확인하고 완료" }).click();
  await page.getByRole("button", { name: "변경 저장하고 홈으로" }).click();
}

test("unknown values are independent, keyboard accessible and retained through the survey", async ({
  page,
}) => {
  await page.goto("/profile");
  await measurements(page);
  const pressure = page.getByRole("textbox", { name: "혈압", exact: true });
  const glucose = page.getByRole("spinbutton", { name: "공복 혈당", exact: true });
  const unknownPressure = page.getByRole("checkbox", { name: "혈압 모름" });
  const unknownGlucose = page.getByRole("checkbox", { name: "공복 혈당 모름" });
  await pressure.fill("130 / 85");
  await glucose.fill("118");
  await unknownPressure.check();
  await expect(pressure).toBeDisabled();
  await expect(pressure).toHaveValue("");
  await expect(glucose).toBeEnabled();
  await expect(glucose).toHaveValue("118");
  await unknownPressure.uncheck();
  await expect(pressure).toHaveValue("130 / 85");
  await unknownPressure.check();
  await unknownGlucose.focus();
  await page.keyboard.press("Space");
  await expect(unknownGlucose).toBeChecked();
  await expect(glucose).toBeDisabled();
  await habits(page);
  await page
    .getByRole("radiogroup", { name: "흡연 여부" })
    .getByRole("radio", { name: "모름" })
    .check();
  await family(page);
  for (const name of ["고혈압 가족력", "당뇨 가족력"]) {
    const group = page.getByRole("radiogroup", { name });
    await expect(group.getByRole("radio")).toHaveCount(3);
    await group.getByRole("radio", { name: "모름" }).check();
  }
  await page.getByRole("button", { name: "다음: 확인하고 완료" }).click();
  await page.getByRole("button", { name: "변경 저장하고 홈으로" }).click();
  await expect(page).toHaveURL(/\/home$/);
  await page.goBack();
  await measurements(page);
  await expect(unknownPressure).toBeChecked();
  await expect(unknownGlucose).toBeChecked();
  await expect(pressure).toBeDisabled();
  await expect(glucose).toBeDisabled();
  await habits(page);
  await expect(
    page.getByRole("radiogroup", { name: "흡연 여부" }).getByRole("radio", { name: "모름" }),
  ).toBeChecked();
  await family(page);
  for (const name of ["고혈압 가족력", "당뇨 가족력"])
    await expect(
      page.getByRole("radiogroup", { name }).getByRole("radio", { name: "모름" }),
    ).toBeChecked();
  const persisted = await page.evaluate(() => JSON.stringify(localStorage));
  for (const key of ["bloodPressure", "glucose", "smoking", "hypertensionFamily", "diabetesFamily"])
    expect(persisted).not.toContain(key);
});

test("turning unknown off requires a real measurement instead of accepting null or zero", async ({
  page,
}) => {
  await page.goto("/profile");
  await measurements(page);
  const pressure = page.getByRole("textbox", { name: "혈압", exact: true });
  const glucose = page.getByRole("spinbutton", { name: "공복 혈당", exact: true });
  const next = page.getByRole("button", { name: "다음: 앓고 있는 지병" });
  await pressure.fill("wrong");
  await page.getByRole("checkbox", { name: "공복 혈당 모름" }).check();
  await next.click();
  await expect(page.getByRole("heading", { name: "혈압 / 공복 혈당", exact: true })).toBeVisible();
  await page.getByRole("checkbox", { name: "혈압 모름" }).check();
  await habits(page);
  await finish(page);
  await expect(page).toHaveURL(/\/home$/);
  await page.goBack();
  await measurements(page);
  await page.getByRole("checkbox", { name: "혈압 모름" }).uncheck();
  await page.getByRole("checkbox", { name: "공복 혈당 모름" }).uncheck();
  await expect(pressure).toHaveValue("");
  await expect(glucose).toHaveValue("");
  await next.click();
  await expect(page.getByRole("heading", { name: "혈압 / 공복 혈당", exact: true })).toBeVisible();
  await pressure.fill("120 / 80");
  await next.click();
  await expect(glucose).toBeVisible();
  await glucose.fill("110");
  await habits(page);
  const smoking = page.getByRole("radiogroup", { name: "흡연 여부" });
  await smoking.getByRole("radio", { name: "모름" }).check();
  await page.keyboard.press("ArrowLeft");
  await expect(smoking.getByRole("radio", { name: "예", exact: true })).toBeChecked();
  await finish(page);
  await expect(page).toHaveURL(/\/home$/);
});
