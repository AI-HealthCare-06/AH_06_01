import { expect, test, type Page } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { expectNoHorizontalOverflow } from "./helpers/layout";

async function openDemoSurvey(page: Page) {
  await page.clock.setFixedTime(new Date("2026-11-02T12:00:00Z"));
  await page.goto("/demo/studio-quarter");
  await expect(page.getByRole("region", { name: "최종 분석 요약" })).toContainText(
    "혈압 측정 기록 분석",
  );
  await page.evaluate(async () => {
    const p = "/src/stores/game-store.ts";
    const { useGameStore } = await import(p);
    useGameStore.getState().suspendSession();
  });
  await page.getByRole("link", { name: "혈압 기록하기" }).click();
  await expect(page.getByRole("dialog", { name: "오늘의 건강 서베이", exact: true })).toBeVisible();
}
async function nextToReview(page: Page) {
  for (let i = 0; i < 9; i++) await page.getByRole("button", { name: "다음", exact: true }).click();
  await expect(page.getByRole("heading", { name: "입력 내용 확인", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "오늘 기록 수정", exact: true }).click();
  await expect(page.getByRole("button", { name: "입력값 수정", exact: true })).toBeVisible();
}
async function journal(page: Page) {
  return page.evaluate(async () => {
    const p = "/src/stores/blood-pressure-store.ts";
    const { useBloodPressureStore } = await import(p);
    return structuredClone(useBloodPressureStore.getState().records);
  });
}

test("survey records explicit metadata, preserves corrections and does not duplicate quest rewards", async ({
  page,
}) => {
  await openDemoSurvey(page);
  const balances = () =>
    page.evaluate(async () => {
      const p = "/src/stores/game-store.ts";
      const { useGameStore } = await import(p);
      const g = useGameStore.getState().game;
      return [g.experience, g.gold];
    });
  const before = await balances();
  await page.locator(".bp-measurement-metadata").first().locator("summary").click();
  const choose = (name: string, option: string) =>
    page
      .getByRole("radiogroup", { name, exact: true })
      .getByRole("radio", { name: option, exact: true })
      .check();
  await choose("아침 측정 시각 확인", "시각 입력");
  await page.getByRole("button", { name: "아침 측정 시각", exact: true }).click();
  const time = page.getByRole("dialog", { name: "아침 측정 시각 설정", exact: true });
  await time.getByLabel("시", { exact: true }).fill("08");
  await time.getByLabel("분", { exact: true }).fill("10");
  await time.getByRole("button", { name: "시간 적용", exact: true }).click();
  await choose("아침 측정 장소", "가정");
  await choose("아침 혈압계 종류", "위팔 커프");
  await page.getByRole("textbox", { name: "아침 혈압계 이름", exact: true }).fill("시연 혈압계");
  await choose("아침 측정 자세 확인", "안정 후 바른 자세");
  await nextToReview(page);
  const first = await journal(page);
  expect(first).toHaveLength(2);
  expect(first[0].command.value.metadata).toMatchObject({
    timePrecision: "minute",
    measuredAt: "2026-11-01T23:10:00.000Z",
    setting: "home",
    method: "upper-arm-cuff",
    deviceLabel: "시연 혈압계",
    protocolConfirmed: true,
  });
  expect(first.every((r) => r.available_at === null)).toBe(true);
  await expect(page.locator(".bp-history-status")).toContainText("이 기기에 저장");
  await page.getByRole("button", { name: "입력값 수정", exact: true }).click();
  await page.getByLabel("아침 수축기", { exact: true }).fill("140");
  await nextToReview(page);
  const changed = await journal(page);
  expect(changed).toHaveLength(3);
  expect(changed[0]).toEqual(first[0]);
  expect(changed[2].command.parent_mutation_id).toBe(first[0].command.mutation_id);
  expect(changed[2].command.value.systolic).toBe(140);
  expect(await balances()).toEqual(before);
  if (process.env.REXRUN_BP_CAPTURE) {
    await mkdir(process.env.REXRUN_BP_CAPTURE, { recursive: true });
    await writeFile(
      process.env.REXRUN_BP_CAPTURE + "/commands.private.json",
      JSON.stringify({ synthetic: true, commands: changed.map((r) => r.command) }, null, 2),
    );
    await page.screenshot({ path: process.env.REXRUN_BP_CAPTURE + "/saved.png" });
  }
  await page.reload();
  await expect(page.getByRole("dialog", { name: "오늘의 건강 서베이", exact: true })).toBeVisible();
  expect(await journal(page)).toEqual(changed);
});

test("unknown metadata stays optional and unmeasuring preserves a deletion revision", async ({
  page,
}) => {
  await openDemoSurvey(page);
  await nextToReview(page);
  const first = await journal(page);
  expect(first).toHaveLength(2);
  expect(first.every((r) => r.command.value.metadata.measuredAt === null)).toBe(true);
  await page.getByRole("button", { name: "입력값 수정", exact: true }).click();
  await page
    .getByRole("radiogroup", { name: "오늘 혈압 측정 여부" })
    .getByRole("radio", { name: "측정하지 못했어요", exact: true })
    .check();
  await nextToReview(page);
  const changed = await journal(page);
  expect(changed).toHaveLength(4);
  expect(changed.slice(0, 2)).toEqual(first);
  expect(
    changed
      .slice(2)
      .every((r) => r.command.value.status === "deleted" && r.command.value.systolic === null),
  ).toBe(true);
});

test("optional measurement controls fit small phones", async ({ page }) => {
  await openDemoSurvey(page);
  for (const block of await page.locator(".bp-measurement-metadata").all())
    await block.locator("summary").click();
  for (const width of [320, 390, 430]) {
    await page.setViewportSize({ width, height: 844 });
    await expectNoHorizontalOverflow(page);
    await expectNoHorizontalOverflow(page, ".daily-survey-content");
  }
  if (process.env.REXRUN_BP_CAPTURE) {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator(".daily-survey-content").evaluate((e) => {
      e.scrollTop = 0;
    });
    await page.screenshot({ path: process.env.REXRUN_BP_CAPTURE + "/metadata.png" });
  }
});

test("an old open survey cannot overwrite a newly synchronized pressure value", async ({
  page,
}) => {
  await openDemoSurvey(page);
  const original = await page.getByLabel("아침 수축기", { exact: true }).inputValue();
  await page.evaluate(async () => {
    const gamePath = "/src/stores/game-store.ts",
      journalPath = "/src/stores/blood-pressure-store.ts";
    const { useGameStore } = await import(gamePath);
    const { useBloodPressureStore } = await import(journalPath);
    const game = useGameStore.getState().game;
    useBloodPressureStore
      .getState()
      .recordSurvey({ ...game.dailySurveys[game.date], morning: { systolic: 136, diastolic: 84 } });
  });
  expect(await page.getByLabel("아침 수축기", { exact: true }).inputValue()).toBe(original);
  for (let i = 0; i < 9; i++) await page.getByRole("button", { name: "다음", exact: true }).click();
  await page.getByRole("button", { name: "오늘 기록 수정", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("측정 기록이 갱신됐어요");
  expect(await journal(page)).toHaveLength(2);
  await page.getByRole("button", { name: "서베이 닫기", exact: true }).click();
  await page.getByRole("link", { name: "혈압 기록하기" }).click();
  await expect(page.getByLabel("아침 수축기", { exact: true })).toHaveValue("136");
});
