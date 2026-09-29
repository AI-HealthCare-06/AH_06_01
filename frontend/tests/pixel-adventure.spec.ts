import { expect, test } from "@playwright/test";

test("Sunday calendar follows today across midnight and month end", async ({ page }) => {
  await page.clock.install({ time: new Date(2026, 8, 30, 23, 59, 30) });
  await page.goto("/quests");
  await expect(page.locator(".weekly-calendar button span")).toHaveText([
    "일",
    "월",
    "화",
    "수",
    "목",
    "금",
    "토",
  ]);
  await expect(page.locator('[aria-current="date"]')).toContainText("30");
  await page.clock.runFor(61_000);
  await expect(page.locator('[aria-current="date"]')).toHaveAttribute(
    "aria-label",
    "10월 1일 목요일 오늘",
  );
});

test("device snapshots update the walk bar and complete without a manual button", async ({
  page,
}) => {
  await page.goto("/quests");
  const sync = (count: number) =>
    page.evaluate(async (value) => {
      const path = "/src/stores/game-store.ts";
      const { useGameStore } = await import(path);
      const store = useGameStore.getState();
      store.syncSteps({
        date: store.game.date,
        count: value,
        source: "healthkit",
        syncedAt: Date.now(),
      });
    }, count);
  const bar = page.getByRole("progressbar", { name: "6,000걸음 걷기 진행도" });
  await sync(3000);
  await expect(bar).toHaveAttribute("aria-valuenow", "50");
  await sync(6000);
  await expect(bar).toHaveAttribute("aria-valuenow", "100");
  await expect(page.locator(".quest-row").nth(2).locator(".pixel-check")).toBeVisible();
  await sync(6800);
  await page.goto("/shop");
  await expect(page.locator(".wallet-balance > strong")).toHaveText("1,280");
  await page.goto("/quests/walk");
  await expect(page.getByRole("button", { name: "오늘 완료한 퀘스트예요" })).toBeDisabled();
});

test("wave combat pauses, requires multiple hits and awards Gold separately", async ({ page }) => {
  await page.clock.install();
  await page.clock.pauseAt(new Date());
  await page.goto("/home");
  await page.clock.runFor(50);
  await expect(page.locator(".battle-enemy")).toHaveCount(1);
  await expect(page.locator(".enemy-hp")).toHaveAttribute("aria-valuenow", "70");
  await page.getByRole("button", { name: "모험 일시정지" }).click();
  const enemyPosition = await page.locator(".battle-enemy").getAttribute("style");
  await page.clock.runFor(10_000);
  await expect(page.locator(".battle-enemy")).toHaveAttribute("style", enemyPosition!);
  await page.getByRole("button", { name: "모험 재개" }).click();
  await page.clock.runFor(3300);
  await expect(page.locator(".enemy-hp")).toHaveAttribute("aria-valuenow", "50");
  await page.clock.runFor(1500);
  await expect(page.locator(".battle-coin")).toContainText("+30 G");
  await expect(page.getByRole("progressbar", { name: "스테이지 몬스터 처치" })).toHaveAttribute(
    "aria-valuenow",
    "1",
  );
  await page.clock.runFor(300);
  await expect(page.locator(".battle-enemy")).toHaveCount(1);
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("rexrun-demo-game-v1")!));
  expect(saved.gold).toBe(1310);
});

test("camera requests on click, captures, and stops all tracks on navigation", async ({ page }) => {
  await page.addInitScript(() => {
    const tracks: MediaStreamTrack[] = [];
    let requests = 0;
    Object.defineProperty(navigator.mediaDevices, "getUserMedia", {
      configurable: true,
      value: async () => {
        requests++;
        const canvas = document.createElement("canvas");
        canvas.width = 640;
        canvas.height = 480;
        const context = canvas.getContext("2d")!;
        context.fillStyle = "#397a4b";
        context.fillRect(0, 0, 640, 480);
        const stream = canvas.captureStream(10);
        tracks.push(...stream.getTracks());
        return stream;
      },
    });
    Reflect.set(window, "cameraTest", { tracks, requests: () => requests });
  });
  await page.goto("/camera");
  expect(await page.evaluate(() => Reflect.get(window, "cameraTest").requests())).toBe(0);
  await page.getByRole("button", { name: "카메라 켜기" }).click();
  await expect(page.getByRole("button", { name: "촬영하기" })).toBeVisible();
  await page.getByRole("button", { name: "촬영하기" }).click();
  await expect(page.getByAltText("촬영한 퀘스트 사진")).toBeVisible();
  expect(
    await page.evaluate(() =>
      Reflect.get(window, "cameraTest").tracks.every(
        (track: MediaStreamTrack) => track.readyState === "ended",
      ),
    ),
  ).toBe(true);
  await page.getByRole("button", { name: "다시 촬영" }).click();
  await expect(page.getByRole("button", { name: "촬영하기" })).toBeVisible();
  await page.getByRole("button", { name: "퀘스트 찾기", exact: true }).click();
  await expect(page).toHaveURL(/\/quests$/);
  await expect(page.locator(".camera-card")).toHaveCount(0);
  expect(
    await page.evaluate(() =>
      Reflect.get(window, "cameraTest").tracks.every(
        (track: MediaStreamTrack) => track.readyState === "ended",
      ),
    ),
  ).toBe(true);
  await expect(page.locator(".quest-row .pixel-check")).toHaveCount(0);
});

test("camera denial gives a retry path", async ({ page }) => {
  await page.addInitScript(() =>
    Object.defineProperty(navigator.mediaDevices, "getUserMedia", {
      value: async () => {
        throw new DOMException("denied", "NotAllowedError");
      },
    }),
  );
  await page.goto("/camera");
  await page.getByRole("button", { name: "카메라 켜기" }).click();
  await expect(page.locator(".camera-status")).toContainText("권한이 꺼져");
  await expect(page.getByRole("button", { name: "카메라 켜기" })).toBeEnabled();
});
