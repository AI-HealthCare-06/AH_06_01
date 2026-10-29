import { selectPixelOption } from "./helpers/controls";
import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";

test("water completion feedback appears once at detection and respects reduced motion", async ({
  page,
}) => {
  await page.clock.install();
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/cv");
  await page.getByRole("button", { name: "합성 시연", exact: true }).click();
  await page.clock.runFor(1000);
  const feedback = page.getByRole("status", { name: "시연 동작 감지", exact: true });
  await expect(feedback).toHaveCount(0);
  for (
    let i = 0;
    i < 24 && (await page.locator(".cv-process").getAttribute("data-phase")) !== "result";
    i++
  )
    await page.clock.runFor(250);
  await expect(feedback).toBeVisible();
  await expect(feedback.locator("svg")).toHaveCSS("animation-name", "none");
  await page.clock.runFor(1200);
  await expect(feedback).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "과정 동작 감지", exact: true })).toBeVisible();
});

test("opt-in feature export keeps synthetic input explicit and contains no pixels or raw landmarks", async ({
  page,
}) => {
  await page.clock.install();
  await page.goto("/cv");
  await page.getByText("학습 및 검증 기록", { exact: true }).click();
  await page.getByRole("checkbox", { name: "동작 특징 기록에 동의해요" }).check();
  await page.getByRole("button", { name: "합성 시연", exact: true }).click();
  await page.clock.runFor(12000);
  await expect(page.getByRole("heading", { name: "과정 동작 감지", exact: true })).toBeVisible();
  await selectPixelOption(page.getByRole("combobox", { name: "시도한 동작 라벨" }), "drinking");
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "결과 JSON 저장" }).click();
  const file = await download;
  const json = await readFile((await file.path())!, "utf8");
  const data = JSON.parse(json);
  expect(data.trainingExample.synthetic).toBe(true);
  expect(data.trainingExample.inputSource).toBe("sample");
  expect(data.trainingExample.label).toBe("water");
  expect(data.trainingExample.frames.length).toBeGreaterThanOrEqual(20);
  expect(
    data.trainingExample.frames.every((f: { values: number[] }) => f.values.length === 23),
  ).toBe(true);
  expect(json).not.toMatch(/data:image|faceLandmarks|worldLandmarks|handLandmarks/);
});

for (const quest of ["water", "medicine", "injection"] as const) {
  test(`${quest} process sample finishes without camera access or quest proof`, async ({
    page,
  }) => {
    await page.clock.install();
    await page.addInitScript(() => {
      let requests = 0;
      Object.defineProperty(navigator.mediaDevices, "getUserMedia", {
        value: async () => {
          requests++;
          throw new Error("Camera should not be used by samples");
        },
      });
      Reflect.set(window, "cameraRequests", () => requests);
    });
    await page.goto(`/cv?task=${quest}`);
    if (quest === "injection")
      await selectPixelOption(page.getByRole("combobox", { name: "사용한 투약 도구" }), "syringe");
    if (quest !== "water") {
      await expect(page.getByRole("button", { name: "합성 시연", exact: true })).toBeDisabled();
      await page.getByRole("checkbox").first().check();
    }
    await page.getByRole("button", { name: "합성 시연", exact: true }).click();
    await page.clock.runFor(12_000);
    await expect(page.getByRole("heading", { name: "과정 동작 감지", exact: true })).toBeVisible();
    await expect(page.getByRole("region", { name: "과정 인식 결과", exact: true })).toContainText(
      "합성 입력",
    );
    expect(await page.evaluate(() => Reflect.get(window, "cameraRequests")())).toBe(0);
    const proofs = await page.evaluate(async () => {
      const modulePath = "/src/stores/quest-verification-store.ts";
      const { useQuestVerificationStore } = await import(modulePath);
      return useQuestVerificationStore.getState().proofs;
    });
    expect(proofs).toEqual({});
    await expect(page.locator("video")).toHaveJSProperty("srcObject", null);
    for (const width of [320, 390, 430]) {
      await page.setViewportSize({ width, height: 844 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
    }
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: "결과 JSON 저장" }).click();
    const file = await download;
    expect(file.suggestedFilename()).toBe(`rexrun-cv-${quest}-sample.json`);
    const result = JSON.parse(await readFile((await file.path())!, "utf8"));
    expect(result.inputSource).toBe("sample");
    expect(result.verificationLevel).toBe("experimental_process");
    if (quest === "injection") {
      expect(result.userDeclaredTool).toBe("syringe");
      expect(result.toolDetected).toBe(false);
      expect(result.needleInsertionVerified).toBe(false);
      expect(result.doseVerified).toBe(false);
      expect(result.kind).toBe("injection_site_hand_process");
    }
  });
}

for (const task of ["medicine", "injection"] as const) {
  test(`${task} front camera uses actual model inference and rejects empty video`, async ({
    page,
  }) => {
    test.setTimeout(90_000);
    await page.addInitScript(() => {
      let options: MediaStreamConstraints | undefined;
      Object.defineProperty(navigator.mediaDevices, "getUserMedia", {
        value: async (requested: MediaStreamConstraints) => {
          options = requested;
          const canvas = document.createElement("canvas");
          canvas.width = 640;
          canvas.height = 480;
          const context = canvas.getContext("2d")!;
          let tick = 0;
          const draw = () => {
            context.fillStyle = tick++ % 2 ? "#222222" : "#232323";
            context.fillRect(0, 0, 640, 480);
          };
          draw();
          const timer = setInterval(draw, 100);
          const stream = canvas.captureStream(10);
          Reflect.set(window, "testCamera", { stream, options: () => options, timer });
          return stream;
        },
      });
    });
    await page.goto(`/cv?task=${task}`);
    await page.getByRole("checkbox").first().check();
    const objectModel = page.waitForResponse(
      (response) =>
        response
          .url()
          .includes(task === "medicine" ? "efficientdet_lite0.tflite" : "hand_landmarker.task") &&
        response.ok(),
    );
    await page.getByRole("button", { name: "전면 카메라 시작", exact: true }).click();
    await objectModel;
    await expect(page.locator(".cv-process")).toHaveAttribute("data-phase", "observing", {
      timeout: 60_000,
    });
    await expect(page.locator(".cv-diagnostics dd").nth(1)).toHaveText(/\d+ms/, {
      timeout: 20_000,
    });
    await expect(page.locator(".cv-source-badge")).toHaveText("FRONT · LOCAL", { timeout: 60_000 });
    if (task === "injection") {
      await expect(page.locator(".cv-live-message")).toContainText("부위를 터치");
      await page.getByRole("button", { name: "화면 중앙을 관찰 부위로 선택", exact: true }).click();
      await expect(page.locator(".cv-live-message")).toContainText("손이 함께");
      await expect(page.locator(".cv-landmarks circle")).toHaveCount(1);
    } else
      await expect(page.locator(".cv-live-message")).toContainText("얼굴", { timeout: 20_000 });
    const constraints = await page.evaluate(() => Reflect.get(window, "testCamera").options());
    expect(constraints.video.facingMode.ideal).toBe("user");
    expect(constraints.audio).toBe(false);
    await expect(page.locator("video")).toHaveCSS("object-fit", "contain");
    await page.getByRole("button", { name: "인식 중단", exact: true }).click();
    expect(
      await page.evaluate(() =>
        Reflect.get(window, "testCamera")
          .stream.getTracks()
          .every((track: MediaStreamTrack) => track.readyState === "ended"),
      ),
    ).toBe(true);
    await expect(page.getByRole("region", { name: "과정 인식 결과", exact: true })).toHaveCount(0);
  });
}

test("mobile testers can open CV from the quest tab without starting the camera", async ({
  page,
}) => {
  await page.goto("/quests");
  await page.getByRole("link", { name: "전면 카메라 CV 테스트", exact: true }).click();
  await expect(page).toHaveURL(/\/cv$/);
  await expect(page.getByRole("heading", { name: "FRONT CAMERA CV", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "주사·인슐린", exact: true })).toBeVisible();
  await expect(page.locator("video")).toHaveJSProperty("srcObject", null);
});
