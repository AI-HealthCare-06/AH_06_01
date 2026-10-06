import { expect, test } from "@playwright/test";

test.use({
  launchOptions: {
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined,
    args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"],
  },
});

for (const quest of ["water", "medicine"] as const) {
  test(`${quest} sample uses the pixel controls without completing quests or saving results`, async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.clock.install();
    await page.goto(`/camera?quest=${quest}&source=sample`);
    await expect(page.getByRole("heading", { name: "QUEST CAMERA" })).toBeVisible();
    const before = await page.evaluate(async () => {
      const path = "/src/stores/game-store.ts";
      const { useGameStore } = await import(path);
      useGameStore.getState().togglePause();
      const { game } = useGameStore.getState();
      return {
        completed: game.completed,
        activity: game.activity,
        lastWaterAt: game.lastWaterAt,
        experience: game.experience,
        gold: game.gold,
      };
    });
    await page.getByRole("button", { name: "샘플 동작 보기" }).click();
    if (quest === "medicine") {
      await expect(page.locator(".camera-status")).toContainText("약을 준비했는지");
      await expect(page.getByRole("button", { name: "샘플 종료" })).toHaveCount(0);
      await page.getByRole("button", { name: "약 준비 확인하고 시작" }).click();
    }
    await expect(page.locator(".camera-mode")).toContainText("샘플");
    await page.clock.runFor(6000);
    await expect(page.getByRole("button", { name: "동작 확인", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "동작 확인", exact: true }).click();
    await expect(page.getByRole("button", { name: "확인 완료" })).toBeDisabled();
    await expect(page.locator(".camera-status")).toContainText("샘플 시연 결과");
    await expect(page.locator("video")).toHaveJSProperty("srcObject", null);
    const after = await page.evaluate(async () => {
      const path = "/src/stores/game-store.ts";
      const { useGameStore } = await import(path);
      const { game } = useGameStore.getState();
      return {
        completed: game.completed,
        activity: game.activity,
        lastWaterAt: game.lastWaterAt,
        experience: game.experience,
        gold: game.gold,
      };
    });
    expect(after).toEqual(before);
    expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toMatch(
      /drinking_motion|hand_to_mouth_motion|userConfirmed|sessionId/,
    );
    expect(errors).toEqual([]);
    await page.reload();
    await expect(page.getByRole("button", { name: "샘플 동작 보기" })).toBeVisible();
    await expect(page.locator(".camera-actions")).toHaveCount(0);
  });
}

test("sample cancellation and quest changes discard in-progress motion", async ({ page }) => {
  await page.clock.install();
  await page.goto("/camera?quest=water");
  await page.getByRole("combobox").selectOption("water:sample");
  await page.getByRole("button", { name: "샘플 동작 보기" }).focus();
  await page.keyboard.press("Enter");
  await page.clock.runFor(2000);
  await page.getByRole("button", { name: "샘플 종료" }).focus();
  await page.keyboard.press("Space");
  await page.clock.runFor(25_000);
  await expect(page.locator(".camera-actions")).toHaveCount(0);
  await page.getByRole("button", { name: "샘플 동작 보기" }).click();
  await page.getByRole("combobox").selectOption("medicine:sample");
  await expect(page.getByRole("button", { name: "약 준비 확인하고 시작" })).toBeVisible();
  await page.clock.runFor(25_000);
  await expect(page.locator(".camera-actions")).toHaveCount(0);
});

test("permission denial offers the existing sample selector without removed controls", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator.mediaDevices, "getUserMedia", {
      value: () => Promise.reject(new DOMException("Denied", "NotAllowedError")),
    });
  });
  await page.goto("/camera?quest=water");
  await page.getByRole("button", { name: "모션 인식 시작" }).click();
  await expect(page.locator(".camera-status")).toContainText("카메라 권한을 허용");
  await expect(
    page.locator(".camera-card > .primary-button, .camera-note, .camera-quest-link"),
  ).toHaveCount(0);
  await page.getByRole("combobox").selectOption("water:sample");
  await expect(page.getByRole("button", { name: "샘플 동작 보기" })).toBeEnabled();
  await expect(page.locator("video")).toHaveJSProperty("srcObject", null);
});

test("a late permission response after navigation is stopped immediately", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator.mediaDevices, "getUserMedia", {
      value: () =>
        new Promise<MediaStream>((resolve) => Reflect.set(window, "motionPending", resolve)),
    });
  });
  await page.goto("/camera?quest=water");
  await page.getByRole("button", { name: "모션 인식 시작" }).click();
  await expect
    .poll(() => page.evaluate(() => typeof Reflect.get(window, "motionPending")))
    .toBe("function");
  await page.getByRole("button", { name: "퀘스트 찾기", exact: true }).click();
  await expect(page).toHaveURL(/\/quests$/);
  await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 320;
    canvas.height = 240;
    const stream = canvas.captureStream();
    Reflect.set(window, "lateMotionStream", stream);
    Reflect.get(window, "motionPending")(stream);
  });
  await expect
    .poll(() =>
      page.evaluate(() =>
        Reflect.get(window, "lateMotionStream")
          .getTracks()
          .every((track: MediaStreamTrack) => track.readyState === "ended"),
      ),
    )
    .toBe(true);
  await expect(page.locator(".camera-card")).toHaveCount(0);
});

test("real local worker analyses portrait frames and releases camera on capture", async ({
  page,
  context,
}) => {
  test.setTimeout(60_000);
  await context.grantPermissions(["camera"]);
  const uploads: string[] = [],
    external: string[] = [],
    errors: string[] = [];
  const observations: number[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (request) => {
    if (["POST", "PUT", "PATCH"].includes(request.method())) uploads.push(request.url());
    if (request.url().startsWith("https://")) external.push(request.url());
  });
  page.on("worker", (worker) => {
    void worker.evaluate(() => {
      const original = self.postMessage.bind(self);
      self.postMessage = ((
        message: { type?: string; observation?: { frameWidth: number; frameHeight: number } },
        ...args: unknown[]
      ) => {
        if (message.type === "observation")
          console.warn("motion-frame", JSON.stringify(message.observation));
        Reflect.apply(original, self, [message, ...args]);
      }) as typeof self.postMessage;
    });
  });
  page.on("console", (message) => {
    if (message.text().startsWith("motion-frame ")) {
      const frame = JSON.parse(message.text().slice("motion-frame ".length));
      observations.push(frame.frameWidth / frame.frameHeight);
    }
  });
  await page.goto("/camera?quest=water");
  await page.getByRole("button", { name: "모션 인식 시작" }).click();
  await expect(page.getByRole("button", { name: "촬영하기" })).toBeVisible({ timeout: 45_000 });
  await expect.poll(() => observations.length, { timeout: 15_000 }).toBeGreaterThan(0);
  expect(observations.every((ratio) => ratio === 0.75)).toBe(true);
  await page
    .locator("video")
    .evaluate((video) => Reflect.set(window, "motionStream", video.srcObject));
  await page.getByRole("button", { name: "촬영하기" }).click();
  await expect(page.getByAltText("촬영한 퀘스트 사진")).toBeVisible();
  await expect(page.locator("video")).toHaveJSProperty("srcObject", null);
  expect(
    await page.evaluate(() =>
      Reflect.get(window, "motionStream")
        .getTracks()
        .every((track: MediaStreamTrack) => track.readyState === "ended"),
    ),
  ).toBe(true);
  await page.getByRole("button", { name: "이 사진 사용" }).click();
  expect(uploads).toEqual([]);
  expect(external).toEqual([]);
  expect(errors).toEqual([]);
});

test("medicine preparation is required before requesting camera and disconnect is recoverable", async ({
  page,
  context,
}) => {
  test.setTimeout(60_000);
  await context.grantPermissions(["camera"]);
  await page.goto("/camera?quest=medicine");
  await page.getByRole("button", { name: "모션 인식 시작" }).click();
  await expect(page.locator("video")).toHaveJSProperty("srcObject", null);
  await expect(page.locator(".camera-status")).toContainText("반복해서 먹지 마세요");
  await page.getByRole("button", { name: "약 준비 확인하고 시작" }).click();
  await expect(page.getByRole("button", { name: "촬영하기" })).toBeVisible({ timeout: 45_000 });
  await page.locator("video").evaluate((video) => {
    const track = (video.srcObject as MediaStream).getVideoTracks()[0];
    track.stop();
    track.dispatchEvent(new Event("ended"));
  });
  await expect(page.locator(".camera-status")).toContainText("카메라 연결이 끊어졌어요");
  await expect(page.locator("video")).toHaveJSProperty("srcObject", null);
  await expect(page.getByRole("button", { name: "모션 인식 시작" })).toBeEnabled();
});

test("samples keep the portrait pixel layout on narrow screens", async ({ page }) => {
  for (const width of [320, 390, 430]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto("/camera?quest=medicine&source=sample");
    await page.getByRole("button", { name: "샘플 동작 보기" }).click();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    const box = (await page.locator(".camera-viewfinder").boundingBox())!;
    expect(box.width / box.height).toBeCloseTo(0.75, 2);
    await expect(page.locator(".motion-capture-page, .motion-overlay, .motion-result")).toHaveCount(
      0,
    );
  }
});
