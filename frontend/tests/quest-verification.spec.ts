import { expect, test, type Page } from "@playwright/test";
test.setTimeout(60_000);
test.use({
  launchOptions: {
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined,
    args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"],
  },
});

async function photo(page: Page) {
  await page.getByRole("button", { name: "카메라 켜기", exact: true }).click();
  await expect(page.getByRole("button", { name: "촬영하기", exact: true })).toBeVisible({
    timeout: 20_000,
  });
  await expect
    .poll(() => page.locator("video").evaluate((v: HTMLVideoElement) => v.videoWidth))
    .toBeGreaterThan(0);
  await page.getByRole("button", { name: "촬영하기", exact: true }).click();
  await page.getByRole("button", { name: "이 사진 사용", exact: true }).click();
}

async function mockCamera(page: Page) {
  await page.addInitScript(() => {
    Object.defineProperty(navigator.mediaDevices, "getUserMedia", {
      value: async () => {
        const canvas = document.createElement("canvas");
        canvas.width = 720;
        canvas.height = 960;
        const ctx = canvas.getContext("2d")!;
        const paint = () => {
          ctx.fillStyle = "#35576b";
          ctx.fillRect(0, 0, 720, 960);
          ctx.fillStyle = "#f4e2ab";
          ctx.fillRect(80, 160, 560, 640);
        };
        paint();
        const timer = setInterval(paint, 33),
          stream = canvas.captureStream(30);
        for (const track of stream.getTracks()) {
          const stop = track.stop.bind(track);
          track.stop = () => {
            clearInterval(timer);
            stop();
          };
        }
        Reflect.set(window, "photoTestStream", stream);
        return stream;
      },
    });
  });
}

test("all quests refuse completion without their evidence, including direct store calls", async ({
  page,
}) => {
  for (const quest of ["meal", "water", "medicine", "walk"]) {
    await page.goto(`/quests/${quest}`);
    await expect(page.locator(".complete-quest")).toBeDisabled();
  }
  const blocked = await page.evaluate(async () => {
    const path = "/src/stores/game-store.ts";
    const { useGameStore } = await import(path);
    const before = useGameStore.getState().game.experience;
    return {
      results: ["meal", "water", "medicine", "sleep", "walk"].map((q) =>
        useGameStore.getState().complete(q),
      ),
      unchanged: useGameStore.getState().game.experience === before,
    };
  });
  expect(blocked).toEqual({ results: [false, false, false, false, false], unchanged: true });
});

test("meal photo unlocks one completion, with new evidence required for each repeat", async ({
  page,
}) => {
  await mockCamera(page);
  await page.goto("/quests/meal");
  await expect(page.locator(".complete-quest")).toBeDisabled();
  await page.getByRole("link", { name: "식사 사진 인증하기" }).click();
  await photo(page);
  await page.getByRole("link", { name: "인증한 퀘스트 완료하기" }).click();
  await expect(page.getByRole("button", { name: "완료 체크하기", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "완료 체크하기", exact: true }).click();
  await expect(page).toHaveURL(/\/reward$/);
  await page.goto("/quests/meal");
  await expect(page.getByRole("button", { name: /인증 후 초과 클리어/ })).toBeDisabled();
  await page.getByRole("link", { name: "식사 사진 인증하기" }).click();
  await photo(page);
  await page.getByRole("link", { name: "인증한 퀘스트 완료하기" }).click();
  await page.getByRole("button", { name: /인증 후 초과 클리어/ }).click();
  await expect(page).toHaveURL(/\/reward$/);
  expect(
    await page.evaluate(
      () => JSON.parse(localStorage.getItem("rexrun-demo-game-v1")!).activity.meal,
    ),
  ).toBe(2);
  expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain("data:image");
});

test("medicine photos are bound to each dose and cannot mark another dose or grant twice", async ({
  page,
}) => {
  await mockCamera(page);
  await page.addInitScript(() =>
    localStorage.setItem(
      "rexrun-medications-v1",
      JSON.stringify({
        medications: [
          {
            id: "qa",
            name: "합성 테스트 약",
            dose: "처방량",
            condition: "",
            drugClass: "other",
            times: ["09:00", "18:00"],
            active: true,
          },
        ],
        taken: {},
        notificationsEnabled: false,
      }),
    ),
  );
  await page.goto("/camera?quest=medicine");
  await expect(page.locator(".camera-proof-return")).toHaveCount(0);
  const schedule = page.getByRole("combobox", { name: "인증할 복약·투약 시간" });
  await expect(schedule).toContainText("09:00");
  await photo(page);
  const record = page.getByRole("button", { name: "인증한 복약·투약 기록하기", exact: true });
  await expect(record).toBeEnabled();
  await record.click();
  expect(
    await page.evaluate(() => JSON.parse(localStorage.getItem("rexrun-demo-game-v1")!).completed),
  ).not.toContain("medicine");
  const afterOne = await page.evaluate(
    () => JSON.parse(localStorage.getItem("rexrun-medications-v1")!).taken,
  );
  expect(Object.keys(afterOne).filter((key) => afterOne[key])).toHaveLength(1);
  expect(Object.keys(afterOne).find((key) => afterOne[key])).toMatch(/09:00$/);
  await expect(schedule).toContainText("18:00");
  await expect(record).toHaveCount(0);
  await photo(page);
  await record.click();
  expect(
    await page.evaluate(() => JSON.parse(localStorage.getItem("rexrun-demo-game-v1")!).completed),
  ).toContain("medicine");
  // Do not re-seed medication data on subsequent reloads.
  const before = await page.evaluate(() => ({
    game: JSON.parse(localStorage.getItem("rexrun-demo-game-v1")!),
    meds: JSON.parse(localStorage.getItem("rexrun-medications-v1")!),
  }));
  expect(Object.values(before.meds.taken).filter(Boolean)).toHaveLength(2);
  const replay = await page.evaluate(async () => {
    const path = "/src/stores/medication-store.ts";
    const { useMedicationStore } = await import(path);
    return useMedicationStore.getState().markTaken("qa", "09:00");
  });
  expect(replay).toBe(false);
});

test("legacy sleep verification routes to the survey instead of a standalone reward", async ({
  page,
}) => {
  await page.goto("/quests/sleep");
  await expect(page.getByRole("dialog", { name: "오늘의 건강 서베이", exact: true })).toBeVisible();
  await expect(page.locator(".complete-quest")).toHaveCount(0);
});

test("camera denial never unlocks a photo quest", async ({ page }) => {
  await page.addInitScript(() =>
    Object.defineProperty(navigator.mediaDevices, "getUserMedia", {
      value: () => Promise.reject(new DOMException("Denied", "NotAllowedError")),
    }),
  );
  await page.goto("/camera?quest=meal");
  await page.getByRole("button", { name: "카메라 켜기" }).click();
  await expect(page.locator(".camera-status")).toContainText("권한");
  await expect(page.locator(".camera-proof-return")).toHaveCount(0);
  expect(
    await page.evaluate(async () => {
      const path = "/src/stores/quest-verification-store.ts";
      const { useQuestVerificationStore } = await import(path);
      return Object.keys(useQuestVerificationStore.getState().proofs).length;
    }),
  ).toBe(0);
});

test("photo camera disconnect clears the busy state without creating evidence", async ({
  page,
}) => {
  await mockCamera(page);
  await page.goto("/camera?quest=meal");
  await page.getByRole("button", { name: "카메라 켜기" }).click();
  await expect(page.getByRole("button", { name: "촬영하기", exact: true })).toBeVisible();
  await page.evaluate(() => {
    const track = (Reflect.get(window, "photoTestStream") as MediaStream).getVideoTracks()[0];
    track.stop();
    track.dispatchEvent(new Event("ended"));
  });
  await expect(page.getByRole("button", { name: "카메라 켜기" })).toBeEnabled();
  await expect(page.locator(".camera-status")).toContainText("끊어졌어요");
  await expect(page.locator(".camera-proof-return")).toHaveCount(0);
});

test("pixel evidence controls fit narrow phones without horizontal overflow", async ({
  page,
}, testInfo) => {
  await page.addInitScript(() =>
    localStorage.setItem(
      "rexrun-medications-v1",
      JSON.stringify({
        medications: [
          {
            id: "qa-layout",
            name: "테스트 복약 일정",
            dose: "등록한 용량",
            condition: "",
            drugClass: "other",
            times: ["09:00"],
            active: true,
          },
        ],
        taken: {},
        notificationsEnabled: false,
      }),
    ),
  );
  for (const width of [320, 390, 430]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto("/camera?quest=medicine");
    await expect(page.getByRole("combobox", { name: "인증할 복약·투약 시간" })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    if (width === 320) await page.screenshot({ path: testInfo.outputPath("medications-320.png") });
    await page.goto("/quests/meal");
    await expect(page.locator(".complete-quest")).toBeDisabled();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    if (width === 320)
      await page.screenshot({ path: testInfo.outputPath("meal-320.png"), fullPage: true });
  }
});
