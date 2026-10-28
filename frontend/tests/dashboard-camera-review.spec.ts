import { expect, test } from "@playwright/test";

test("date settings use a triangle while the calendar stays visible and selected dates persist", async ({
  page,
}) => {
  await page.goto("/dashboard?period=month&date=2026-10-10");
  const toggle = page.getByRole("button", { name: "날짜 설정 접기", exact: true });
  await expect(toggle).toHaveText("▴");
  await toggle.click();
  await expect(page.getByRole("combobox", { name: "건강 변화 조회 기간" })).toBeHidden();
  const calendar = page.getByLabel("주간 달력", { exact: true });
  await expect(calendar).toBeVisible();
  await expect(calendar.getByRole("button")).toHaveCount(7);
  await calendar.getByRole("button", { name: /10월 8일/ }).click();
  await page.getByRole("button", { name: "날짜 설정 펼치기", exact: true }).click();
  await expect(page.getByRole("combobox", { name: "건강 변화 조회 기간" })).toContainText("월간");
  await expect(page.getByRole("button", { name: "조회 기준 날짜" })).toHaveAttribute(
    "data-date",
    "2026-10-08",
  );
  await expect(page.locator(".summary-next-quest")).toHaveCount(0);
});

test("quick blood pressure validates pairs and changes only the existing profile pressure", async ({
  page,
}) => {
  await page.goto("/dashboard/report");
  const before = await page.evaluate(async () => {
    const p = "/src/stores/profile-store.ts";
    const { useProfileStore } = await import(p);
    useProfileStore.getState().setProfile({
      ...useProfileStore.getState().profile,
      name: "Synthetic BP QA",
      height: 173,
      weight: 72,
      bloodPressure: null,
      specialHistory: "Synthetic retained history",
    });
    return structuredClone(useProfileStore.getState().profile);
  });
  const record = page.getByRole("button", { name: "혈압 기록", exact: true });
  await record.click();
  const dialog = page.getByRole("dialog", { name: "혈압 바로 기록" });
  await dialog.getByRole("spinbutton", { name: "수축기 혈압" }).fill("80");
  await dialog.getByRole("spinbutton", { name: "이완기 혈압" }).fill("120");
  await dialog.getByRole("button", { name: "기록 저장", exact: true }).click();
  await expect(dialog.getByRole("alert")).toBeVisible();
  await dialog.getByRole("spinbutton", { name: "수축기 혈압" }).fill("123");
  await dialog.getByRole("spinbutton", { name: "이완기 혈압" }).fill("78");
  await dialog.getByRole("button", { name: "기록 저장", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator(".bp-measurement").first()).toContainText("123 / 78");
  expect(
    await page.evaluate(async () => {
      const p = "/src/stores/profile-store.ts";
      const { useProfileStore } = await import(p);
      return useProfileStore.getState().profile;
    }),
  ).toEqual({ ...before, bloodPressure: "123 / 78" });
  await record.click();
  await expect(page.getByRole("spinbutton", { name: "수축기 혈압" })).toHaveValue("123");
  await page.getByRole("spinbutton", { name: "수축기 혈압" }).fill("130");
  await page.keyboard.press("Escape");
  await expect(record).toBeFocused();
  await expect(page.locator(".bp-measurement").first()).toContainText("123 / 78");
});

test("pressure-only input does not mark sample demographics as entered", async ({ page }) => {
  await page.goto("/dashboard/report");
  await page.getByRole("button", { name: "혈압 기록", exact: true }).click();
  await page.getByRole("spinbutton", { name: "수축기 혈압" }).fill("126");
  await page.getByRole("spinbutton", { name: "이완기 혈압" }).fill("81");
  await page.getByRole("button", { name: "기록 저장", exact: true }).click();
  expect(
    await page.evaluate(async () => {
      const p = "/src/stores/profile-store.ts";
      const { useProfileStore } = await import(p);
      const s = useProfileStore.getState();
      return {
        profileEntered: s.hasProfileInput,
        pressureEntered: s.hasBloodPressureInput,
        value: s.profile.bloodPressure,
      };
    }),
  ).toEqual({ profileEntered: false, pressureEntered: true, value: "126 / 81" });
});

test("medication task opens camera directly and preserves existing schedules and completed doses", async ({
  page,
}) => {
  await page.goto("/home");
  await page.evaluate(async () => {
    const p = "/src/stores/medication-store.ts",
      d = "/src/domain/calendar.ts";
    const { useMedicationStore } = await import(p),
      { localDate } = await import(d);
    useMedicationStore.getState().restore({
      medications: [
        {
          id: "qa-camera",
          name: "Synthetic scheduled medicine",
          dose: "prescribed",
          times: ["08:00", "18:00"],
          condition: "",
          drugClass: "other",
          active: true,
        },
      ],
      taken: { [localDate() + "|qa-camera|08:00"]: true },
      notificationsEnabled: false,
    });
  });
  await page.goto("/medications");
  await expect(page.getByRole("heading", { name: "오늘의 복약 퀘스트" })).toHaveCount(0);
  await page.goto("/quests/medicine");
  await page.getByRole("link", { name: "복약 일정·사진 인증하기" }).click();
  await expect(page).toHaveURL(/\/camera\?quest=medicine$/);
  await expect(page.getByRole("combobox", { name: "기록할 퀘스트" })).toContainText("약 / 영양제");
  await expect(page.locator("#medication-records")).toHaveCount(0);
  await expect(page.locator(".camera-proof-return")).toHaveCount(0);
  await expect(page.getByRole("combobox", { name: "인증할 복약·투약 시간" })).toContainText(
    "18:00",
  );
  expect(
    await page.evaluate(
      () =>
        Object.values(JSON.parse(localStorage.getItem("rexrun-medications-v1")!).taken).filter(
          Boolean,
        ).length,
    ),
  ).toBe(1);
});

test("health reports stay in normal flow without horizontal overflow on phones", async ({
  page,
}, testInfo) => {
  for (const width of [320, 390, 534]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto("/dashboard/report");
    await expect(page.locator(".score-number")).toHaveText("82");
    const heading = (await page.locator(".dashboard-heading").boundingBox())!,
      score = (await page.locator(".health-score").first().boundingBox())!;
    expect(score.y).toBeGreaterThanOrEqual(heading.y + heading.height);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({
      path: testInfo.outputPath("dashboard-" + width + ".png"),
      fullPage: true,
    });
    await page.getByRole("button", { name: "혈압 기록", exact: true }).click();
    const entryDialog = page.getByRole("dialog", { name: "혈압 바로 기록" });
    const entryBounds = (await entryDialog.boundingBox())!;
    expect(entryBounds.x).toBeGreaterThanOrEqual(0);
    expect(entryBounds.x + entryBounds.width).toBeLessThanOrEqual(width);
    await entryDialog.screenshot({ path: testInfo.outputPath("pressure-entry-" + width + ".png") });
    await page.keyboard.press("Escape");
    await page.goto("/dashboard/report");
    await expect(page.getByRole("button", { name: "혈압 기록", exact: true })).toBeVisible();
    await expect(page.locator(".report-next")).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  }
});
