import { expect, test } from "@playwright/test";

test("unknown values are independent, keyboard accessible and retained during onboarding", async ({
  page,
}) => {
  await page.goto("/profile");
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
  for (const name of ["흡연 여부", "고혈압 가족력", "당뇨 가족력"]) {
    const group = page.getByRole("radiogroup", { name });
    await expect(group.getByRole("radio")).toHaveCount(3);
    await group.getByRole("radio", { name: "모름" }).check();
  }
  await page.getByRole("button", { name: "공룡 깨우기" }).click();
  await expect(page).toHaveURL(/\/dinosaur$/);
  await page.goBack();
  await expect(unknownPressure).toBeChecked();
  await expect(unknownGlucose).toBeChecked();
  await expect(pressure).toBeDisabled();
  await expect(glucose).toBeDisabled();
  for (const name of ["흡연 여부", "고혈압 가족력", "당뇨 가족력"]) {
    await expect(
      page.getByRole("radiogroup", { name }).getByRole("radio", { name: "모름" }),
    ).toBeChecked();
  }
  const persisted = await page.evaluate(() => JSON.stringify(localStorage));
  for (const key of ["bloodPressure", "glucose", "smoking", "hypertensionFamily", "diabetesFamily"])
    expect(persisted).not.toContain(key);
});

test("turning unknown off requires a real measurement instead of silently accepting null", async ({
  page,
}) => {
  await page.goto("/profile");
  const pressure = page.getByRole("textbox", { name: "혈압", exact: true });
  const glucose = page.getByRole("spinbutton", { name: "공복 혈당", exact: true });
  const submit = page.getByRole("button", { name: "공룡 깨우기" });
  await pressure.fill("wrong");
  await page.getByRole("checkbox", { name: "공복 혈당 모름" }).check();
  await submit.click();
  await expect(page).toHaveURL(/\/profile$/);
  await page.getByRole("checkbox", { name: "혈압 모름" }).check();
  await submit.click();
  await expect(page).toHaveURL(/\/dinosaur$/);
  await page.goBack();
  await page.getByRole("checkbox", { name: "혈압 모름" }).uncheck();
  await page.getByRole("checkbox", { name: "공복 혈당 모름" }).uncheck();
  await expect(pressure).toHaveValue("");
  await expect(glucose).toHaveValue("");
  await submit.click();
  await expect(page).toHaveURL(/\/profile$/);
  await pressure.fill("120 / 80");
  await submit.click();
  await expect(page).toHaveURL(/\/profile$/);
  await glucose.fill("110");
  const smoking = page.getByRole("radiogroup", { name: "흡연 여부" });
  await smoking.getByRole("radio", { name: "모름" }).check();
  await page.keyboard.press("ArrowLeft");
  await expect(smoking.getByRole("radio", { name: "예", exact: true })).toBeChecked();
  await submit.click();
  await expect(page).toHaveURL(/\/dinosaur$/);
});
