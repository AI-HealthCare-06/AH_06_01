import { expect, test } from "@playwright/test";
import { setMedicationTime } from "./fixtures/medication-time";
import { authenticateDose } from "./fixtures/quest-evidence";

test("signup uses short pages and preserves custom histories and medication times", async ({
  page,
}) => {
  await page.goto("/login");
  await page.getByRole("link", { name: /가입하기/ }).click();
  await expect(page.getByRole("textbox", { name: "이름", exact: true })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "혈압", exact: true })).toHaveCount(0);
  await page.getByRole("textbox", { name: "이름", exact: true }).fill("테스트");
  await page.getByRole("button", { name: "다음: 혈압 정보" }).click();
  await page.getByRole("button", { name: "다음: 확인하고 완료" }).click();
  await page.getByRole("button", { name: "공룡 깨우기" }).click();
  await page.getByRole("link", { name: "모험 시작하기" }).click();
  await page.getByRole("link", { name: "첫 퀘스트 시작하기" }).click();
  await page.goto("/quests");
  await page.getByRole("link", { name: /지병 기록하기/ }).click();
  await page.getByRole("checkbox", { name: "고혈압", exact: true }).check();
  await page.getByRole("button", { name: "다음: 그 밖의 만성질환" }).click();
  await page.getByRole("button", { name: "다음: 특수 이력 / 치료 상태" }).click();
  await page.getByRole("textbox", { name: "추가 지병 이름" }).fill("희귀 유전병");
  await page.getByRole("button", { name: "추가", exact: true }).click();
  await page.getByRole("textbox", { name: "특수 이력 / 주의사항" }).fill("개별 주치의 확인 필요");
  await expect(page.getByLabel("특수 이력 / 주의사항")).toHaveCSS("resize", "none");
  await page.getByRole("button", { name: "다음: 복용 중인 약과 시간" }).click();
  await page.getByRole("button", { name: "+ 약 / 영양제 등록" }).click();
  await page
    .getByRole("textbox", { name: "약 / 영양제 이름", exact: true })
    .fill("처방된 테스트 약");
  await page.getByRole("button", { name: "다음: 복용 항목" }).click();
  await page.getByRole("button", { name: "다음: 복용 시간", exact: true }).click();
  await setMedicationTime(page, 1, "09:30");
  await page.getByRole("button", { name: "항목 저장", exact: true }).click();
  await page.getByRole("button", { name: "다음: 확인하고 완료", exact: true }).click();
  await page.getByRole("button", { name: "이전", exact: true }).click();
  await expect(page.getByText("09:30", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "이전", exact: true }).click();
  await expect(page.getByText("희귀 유전병", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "다음: 복용 중인 약과 시간" }).click();
  await page.getByRole("button", { name: "다음: 확인하고 완료", exact: true }).click();
  await page.getByRole("button", { name: "퀘스트 기록 완료" }).click();
  await expect(page).toHaveURL(/\/quests$/);
  await page.goto("/medications");
  await expect(page.getByText("처방된 테스트 약", { exact: true })).toBeVisible();
  await expect(page.getByText("09:30", { exact: true })).toBeVisible();
});

test("daily doses persist, grant the medicine quest once, and logout freezes gameplay", async ({
  page,
}) => {
  await page.clock.install({ time: new Date("2026-10-13T03:00:00Z") });
  await page.clock.pauseAt(new Date("2026-10-13T03:00:01Z"));
  await page.goto("/home");
  await page.getByRole("button", { name: "복용 중인 약 / 영양제 관리" }).click();
  await page.getByRole("button", { name: "+ 약 / 영양제 등록" }).click();
  await page.getByRole("textbox", { name: "약 / 영양제 이름", exact: true }).fill("테스트 약");
  await page.getByRole("button", { name: "+ 시간 추가" }).click();
  await page.getByRole("button", { name: "항목 저장", exact: true }).click();
  await page.goto("/camera?quest=medicine");
  await authenticateDose(page, "08:00");
  await page.evaluate(async () => {
    const { useMedicationStore } = await import("/src/stores/medication-store.ts");
    const store = useMedicationStore.getState();
    if (!store.markTaken(store.medications[0].id, "08:00"))
      throw Error("Verified dose was not accepted");
  });
  const before = await page.evaluate(
    () => JSON.parse(localStorage.getItem("rexrun-demo-game-v1")!).experience,
  );
  expect(
    await page.evaluate(() => JSON.parse(localStorage.getItem("rexrun-demo-game-v1")!).completed),
  ).not.toContain("medicine");
  await authenticateDose(page, "20:00");
  await page.evaluate(async () => {
    const { useMedicationStore } = await import("/src/stores/medication-store.ts");
    const store = useMedicationStore.getState();
    if (!store.markTaken(store.medications[0].id, "20:00"))
      throw Error("Verified dose was not accepted");
  });
  const after = await page.evaluate(
    () => JSON.parse(localStorage.getItem("rexrun-demo-game-v1")!).experience,
  );
  expect(after).toBeGreaterThan(before);
  await page.reload();
  await expect(page.getByRole("combobox", { name: "인증할 복약·투약 시간" })).toContainText(
    "등록된 미완료 일정 없음",
  );
  expect(
    await page.evaluate(() => JSON.parse(localStorage.getItem("rexrun-demo-game-v1")!).experience),
  ).toBe(after);
  await page.goto("/me");
  await page.getByRole("button", { name: "로그아웃", exact: true }).click();
  await expect(page).toHaveURL(/\/login$/);
  const loggedOut = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("rexrun-demo-game-v1")!),
  );
  await page.clock.runFor(120_000);
  await page.reload();
  const later = await page.evaluate(() => JSON.parse(localStorage.getItem("rexrun-demo-game-v1")!));
  expect(later.combat).toEqual(loggedOut.combat);
  expect(later.experience).toBe(loggedOut.experience);
  expect(later.gold).toBe(loggedOut.gold);
  expect(later.battlePaused).toBe(true);
  expect(await page.evaluate(() => localStorage.getItem("rexrun-medications-v1"))).toBeNull();
  await page.goto("/home");
  await expect(page).toHaveURL(/\/login$/);
});

test("mobile dashboard keeps the score visible and distinguishes actual inputs from demo/model results", async ({
  page,
}) => {
  for (const width of [320, 390, 430]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto("/dashboard");
    await expect(page.locator(".score-number")).toHaveText("82");
    await expect(page.getByRole("heading", { name: "혈압 기록과 판정" })).toBeVisible();
    await expect(page.getByText("판정 결과 대기", { exact: true })).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    const score = await page.locator(".score-number").boundingBox();
    const card = await page.locator(".health-score").boundingBox();
    const heading = await page.locator(".health-score h3").boundingBox();
    expect(score!.y).toBeGreaterThan(heading!.y + heading!.height);
    expect(score!.y).toBeGreaterThanOrEqual(card!.y);
    expect(score!.y + score!.height).toBeLessThanOrEqual(card!.y + card!.height);
  }
});
