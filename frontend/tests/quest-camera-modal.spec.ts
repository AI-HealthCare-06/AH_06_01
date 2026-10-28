import { expect, test } from "@playwright/test";

test("quest camera locks the mode, preserves photo evidence and releases its stream on close", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator.mediaDevices, "getUserMedia", {
      value: async () => {
        const canvas = document.createElement("canvas");
        canvas.width = 720;
        canvas.height = 960;
        const paint = () => {
          const context = canvas.getContext("2d")!;
          context.fillStyle = "#35576b";
          context.fillRect(0, 0, 720, 960);
        };
        paint();
        const timer = setInterval(paint, 33);
        const stream = canvas.captureStream(30);
        for (const track of stream.getTracks()) {
          const stop = track.stop.bind(track);
          track.stop = () => {
            clearInterval(timer);
            stop();
          };
        }
        Reflect.set(window, "modalTestStream", stream);
        return stream;
      },
    });
  });
  await page.goto("/quests");
  const meal = page.getByRole("button", { name: /건강한 식사하기/ });
  async function open() {
    await meal.click();
    await page.getByRole("dialog").getByRole("button", { name: "인증하기", exact: true }).click();
  }
  await open();
  await expect(page.getByRole("combobox", { name: "기록할 퀘스트" })).toHaveCount(0);
  await page.getByRole("button", { name: "카메라 켜기", exact: true }).click();
  await expect(page.getByRole("button", { name: "촬영하기", exact: true })).toBeVisible();
  await expect
    .poll(() => page.locator("video").evaluate((v: HTMLVideoElement) => v.videoWidth))
    .toBeGreaterThan(0);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(meal).toBeFocused();
  expect(
    await page.evaluate(() =>
      Reflect.get(window, "modalTestStream")
        .getTracks()
        .every((track: MediaStreamTrack) => track.readyState === "ended"),
    ),
  ).toBe(true);
  await open();
  await page.getByRole("button", { name: "카메라 켜기", exact: true }).click();
  await expect
    .poll(() => page.locator("video").evaluate((v: HTMLVideoElement) => v.videoWidth))
    .toBeGreaterThan(0);
  await page.getByRole("button", { name: "촬영하기", exact: true }).click();
  await page.getByRole("button", { name: "이 사진 사용", exact: true }).click();
  await page.getByRole("link", { name: "인증한 퀘스트 완료하기" }).click();
  await expect(page.getByRole("button", { name: "완료 체크하기", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "완료 체크하기", exact: true }).click();
  await expect(page).toHaveURL(/\/reward$/);
  expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain("data:image");
});

test("medication reminders sit next to the medication title without a separate card", async ({
  page,
}) => {
  await page.goto("/medications");
  const header = page.locator(".medication-heading");
  await expect(header.getByRole("heading", { name: "복용 중인 약 / 영양제" })).toBeVisible();
  const toggle = header.getByRole("switch", { name: "복용 시간 알림" });
  await expect(toggle).not.toBeChecked();
  await expect(toggle).toBeDisabled();
  await expect(page.locator(".medication-card")).toHaveCount(1);
  await expect(page.getByRole("button", { name: "복용 알림 켜기" })).toHaveCount(0);
});
