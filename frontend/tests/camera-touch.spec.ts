import { expect, test } from "@playwright/test";

test.use({ hasTouch: true });

test("touching the pixel viewfinder starts and stops sample motion without separate controls", async ({
  page,
}) => {
  await page.clock.install();
  await page.goto("/camera?quest=water&source=sample");
  await expect(
    page.locator(".camera-card > .primary-button, .camera-note, .camera-quest-link"),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "샘플 동작 보기" }).tap();
  await expect(page.getByRole("button", { name: "샘플 종료" })).toBeVisible();
  await page.getByRole("button", { name: "샘플 종료" }).tap();
  await page.clock.runFor(6000);
  await expect(page.getByRole("button", { name: "샘플 동작 보기" })).toBeVisible();
  await expect(page.locator(".camera-actions")).toHaveCount(0);
});

test("touching again cancels a pending permission request and stops its late stream", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator.mediaDevices, "getUserMedia", {
      value: () =>
        new Promise<MediaStream>((resolve) => Reflect.set(window, "cameraPending", resolve)),
    });
  });
  await page.goto("/camera?quest=water");
  await page.getByRole("button", { name: "모션 인식 시작" }).tap();
  await expect
    .poll(() => page.evaluate(() => typeof Reflect.get(window, "cameraPending")))
    .toBe("function");
  await page.getByRole("button", { name: "카메라 준비 취소" }).tap();
  await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 640;
    canvas.height = 480;
    const stream = canvas.captureStream();
    Reflect.set(window, "lateCameraStream", stream);
    Reflect.get(window, "cameraPending")(stream);
  });
  await expect
    .poll(() =>
      page.evaluate(() =>
        Reflect.get(window, "lateCameraStream")
          .getTracks()
          .every((track: MediaStreamTrack) => track.readyState === "ended"),
      ),
    )
    .toBe(true);
  await expect(page.getByRole("button", { name: "모션 인식 시작" })).toBeVisible();
  await expect(page.locator("video")).toHaveJSProperty("srcObject", null);
  await expect(page.locator(".camera-actions")).toHaveCount(0);
});
