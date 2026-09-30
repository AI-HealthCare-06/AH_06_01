import { test, expect } from "@playwright/test";

test("all dinosaurs reach the visible monster during the impact pose", async ({ page }) => {
  await page.clock.install();
  await page.clock.pauseAt(new Date());
  for (let dinosaur = 0; dinosaur < 6; dinosaur++) {
    await page.goto("/home");
    await page.evaluate(async (index) => {
      const path = "/src/stores/game-store.ts";
      const { useGameStore } = await import(path);
      useGameStore.getState().resetDemo();
      useGameStore.getState().chooseDinosaur(index);
    }, dinosaur);
    await page.clock.runFor(3500);
    await expect(page.locator(".battle-enemy")).toHaveAttribute("data-hit", "true");
    await page.getByRole("button", { name: "모험 일시정지" }).click();
    await expect
      .poll(
        async () =>
          page.locator(".battle-dinosaur canvas,.battle-enemy canvas").evaluateAll((elements) => {
            const bounds = elements.map((element) => {
              const canvas = element as HTMLCanvasElement,
                box = canvas.getBoundingClientRect();
              const pixels = canvas
                .getContext("2d")!
                .getImageData(0, 0, canvas.width, canvas.height).data;
              let left = canvas.width,
                top = canvas.height,
                right = 0,
                bottom = 0;
              for (let y = 0; y < canvas.height; y++)
                for (let x = 0; x < canvas.width; x++)
                  if (pixels[(y * canvas.width + x) * 4 + 3] > 80) {
                    left = Math.min(left, x);
                    right = Math.max(right, x);
                    top = Math.min(top, y);
                    bottom = Math.max(bottom, y);
                  }
              return {
                left: box.x + (left * box.width) / canvas.width,
                right: box.x + (right * box.width) / canvas.width,
                top: box.y + (top * box.height) / canvas.height,
                bottom: box.y + (bottom * box.height) / canvas.height,
                loaded: right > left,
              };
            });
            return (
              bounds.length === 2 &&
              bounds.every((b) => b.loaded) &&
              bounds[0].right > bounds[1].left &&
              bounds[0].left < bounds[1].right &&
              bounds[0].bottom > bounds[1].top &&
              bounds[0].top < bounds[1].bottom
            );
          }),
        { message: `dinosaur ${dinosaur} must visually reach the enemy` },
      )
      .toBe(true);
  }
});

test("camera picks the quest lens, switches a live stream and saves portrait framing", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const requests: MediaStreamConstraints[] = [];
    const tracks: MediaStreamTrack[] = [];
    Object.defineProperty(navigator.mediaDevices, "getUserMedia", {
      value: async (options: MediaStreamConstraints) => {
        requests.push(options);
        const canvas = document.createElement("canvas");
        canvas.width = 640;
        canvas.height = 480;
        canvas.getContext("2d")!.fillRect(0, 0, 640, 480);
        const stream = canvas.captureStream();
        tracks.push(...stream.getTracks());
        return stream;
      },
    });
    Reflect.set(window, "cameraReview", { requests, tracks });
  });
  await page.goto("/camera?quest=sleep");
  await expect(page.locator("select option")).toHaveText([
    "약 복용하기",
    "건강한 식사하기",
    "물 8잔 마시기",
  ]);
  await expect(page.locator("select")).toHaveValue("meal");
  await page.getByRole("button", { name: "카메라 켜기" }).click();
  await expect(page.getByRole("button", { name: "촬영하기" })).toBeVisible();
  await page.locator("select").selectOption("medicine");
  await expect(page.getByRole("button", { name: "촬영하기" })).toBeVisible();
  await page.locator("select").selectOption("water");
  await expect(page.getByRole("button", { name: "촬영하기" })).toBeVisible();
  expect(
    await page.evaluate(() =>
      Reflect.get(window, "cameraReview").requests.map(
        (r: MediaStreamConstraints) => (r.video as MediaTrackConstraints).facingMode,
      ),
    ),
  ).toEqual([{ ideal: "environment" }, { ideal: "user" }, { ideal: "user" }]);
  expect(
    await page.evaluate(() =>
      Reflect.get(window, "cameraReview")
        .tracks.slice(0, 2)
        .every((t: MediaStreamTrack) => t.readyState === "ended"),
    ),
  ).toBe(true);
  const bounds = (await page.locator(".camera-viewfinder").boundingBox())!;
  expect(bounds.width / bounds.height).toBeCloseTo(0.75, 2);
  await page.getByRole("button", { name: "촬영하기" }).click();
  const image = page.getByAltText("촬영한 퀘스트 사진");
  await expect(image).toBeVisible();
  expect(
    await image.evaluate((img: HTMLImageElement) => img.naturalWidth / img.naturalHeight),
  ).toBeCloseTo(0.75, 2);
});

test("weather uses coarse current location, reports rain, and handles denial", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation({ latitude: 37.566535, longitude: 126.977969 });
  let requested = "";
  await page.route("https://api.open-meteo.com/**", async (route) => {
    requested = route.request().url();
    await route.fulfill({ json: { current: { temperature_2m: 18, weather_code: 63, is_day: 1 } } });
  });
  await page.goto("/home");
  await expect(page.locator(".weather-greeting")).toContainText("비가 내려요");
  expect(new URL(requested).searchParams.get("latitude")).toBe("37.57");
  expect(new URL(requested).searchParams.get("longitude")).toBe("126.98");
  await context.clearPermissions();
  await page.evaluate(() =>
    Object.defineProperty(navigator.geolocation, "getCurrentPosition", {
      value: (_s: unknown, f: (e: unknown) => void) => f({ code: 1 }),
    }),
  );
  await page.getByRole("button", { name: "내 위치 날씨 새로고침" }).click();
  await expect(page.locator(".notice")).toContainText("위치 권한");
  await expect(page.locator(".weather-greeting")).not.toContainText("비가 내려요");
});

test("dashboard switches monthly/yearly data and shows the saved registration date", async ({
  page,
}) => {
  await page.clock.install({ time: new Date(2026, 8, 29, 16) });
  await page.goto("/profile");
  await page.getByRole("button", { name: "공룡 깨우기" }).click();
  await page.goto("/dashboard");
  await expect(page.locator(".disease-card header small")).toHaveText("등록일 2026.09.29");
  await expect(page.locator(".health-score + .growth-insight")).toBeVisible();
  await expect(page.locator(".growth-insight")).toContainText("공격력 100 → 112");
  await expect(page.locator(".impact-card h3")).toHaveText("퀘스트 효과 예측");
  await expect(page.locator(".prediction-note")).toContainText("실제 결과와 다를 수");
  await expect(page.locator(".health-growth-card .health-score")).toHaveCount(1);
  await expect(page.locator(".health-growth-card .growth-insight")).toHaveCount(1);
  await expect(page.locator(".dashboard-period-select option")).toHaveText([
    "일간",
    "주간",
    "월간",
    "연간",
  ]);
  await page.getByRole("combobox", { name: "건강 변화 조회 기간" }).selectOption("day");
  await expect(page.locator(".health-score h3")).toHaveText("DAILY HEALTH SCORE");
  await expect(page.getByRole("region", { name: "REPORT", exact: true })).toContainText(
    "어제 대비 건강 점수 +1점",
  );
  await expect(page.locator(".trend-column")).toHaveCount(4);
  await page.getByRole("combobox", { name: "건강 변화 조회 기간" }).selectOption("month");
  await expect(page.locator(".health-score h3")).toHaveText("MONTHLY HEALTH SCORE");
  await expect(page.locator(".trend-column")).toHaveCount(4);
  await expect(page.locator(".health-trend")).toContainText("+14점");
  await page.getByRole("combobox", { name: "건강 변화 조회 기간" }).selectOption("year");
  await expect(page.locator(".trend-column")).toHaveCount(12);
  await expect(page.locator(".health-trend")).toContainText("+26점");
  await page.getByRole("combobox", { name: "건강 변화 조회 기간" }).selectOption("week");
  await expect(page.locator(".impact-card")).toBeVisible();
});

test("account controls, top notices and step guidance keep dialogs separate", async ({ page }) => {
  await page.goto("/quests");
  await expect(page.locator(".step-connection")).toHaveCount(0);
  const hint = (await page.locator(".step-connection-note").boundingBox())!;
  const list = (await page.locator(".quest-list").boundingBox())!;
  expect(hint.y + hint.height).toBeLessThanOrEqual(list.y);
  await page.locator(".step-connection-note").click();
  await expect(page.locator(".member-card img")).toBeVisible();
  await expect(page.locator(".camera-dot")).toHaveCount(0);
  await expect(page.locator(".network-status")).toBeVisible();
  await expect(page.locator(".battery-status")).toBeVisible();
  await page.getByRole("button", { name: /웨어러블 장비/ }).click();
  await expect(page.getByRole("dialog")).toContainText("수면 시간");
  await page.keyboard.press("Escape");
  await page.getByRole("switch").click();
  await expect(page.locator(".notice.visible")).toBeVisible();
  expect((await page.locator(".notice").boundingBox())!.y).toBeLessThan(25);
  await page.getByRole("button", { name: "← 뒤로가기" }).click();
  await expect(page).toHaveURL(/\/quests$/);
});

test("home hides status copy, shows both progress bars and keeps the pteranodon airborne", async ({
  page,
}) => {
  await page.goto("/home");
  await expect(page.locator(".compact-quests")).not.toContainText("미완료");
  await expect(page.locator(".compact-quests")).not.toContainText("완료");
  await expect(page.locator(".compact-quests [role=progressbar]")).toHaveCount(2);
  await expect(page.locator(".compact-quest-heading").last()).toContainText("0 / 8잔");
  await page.evaluate(async () => {
    const path = "/src/stores/game-store.ts";
    const { useGameStore } = await import(path);
    useGameStore.getState().chooseDinosaur(4);
  });
  await expect(page.locator(".battle-dinosaur")).toHaveAttribute("data-dinosaur", "4");
  expect(
    await page.locator(".battle-dinosaur").evaluate((e) => parseInt(getComputedStyle(e).top)),
  ).toBeLessThan(100);
  const points = await page.locator('[data-series="today"]').getAttribute("points");
  const vertices = points!.split(" ").map((p) => p.split(",").map(Number));
  expect(vertices).toHaveLength(6);
  await expect(page.locator(".radar-point")).toHaveCount(6);
});
