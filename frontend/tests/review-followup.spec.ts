import { test, expect } from "@playwright/test";

test("all player projectile poses grow through loop wrap with matching collision and debug geometry", async ({
  page,
}) => {
  await page.clock.install();
  await page.clock.pauseAt(new Date());
  await page.goto("/home");
  await page.getByRole("button", { name: "전투 디버그 표시" }).click();
  for (let dinosaur = 0; dinosaur < 6; dinosaur++) {
    let previousSize = 0;
    for (const step of [0, 1, 2, 3, 4, 10, 11]) {
      const frame = step % 4;
      await page.evaluate(
        async ({ dinosaur, step }) => {
          const path = "/src/stores/game-store.ts";
          const { useGameStore } = await import(path);
          const { game } = useGameStore.getState();
          useGameStore.setState({
            paused: true,
            game: {
              ...game,
              dinosaur,
              battlePaused: true,
              combat: {
                ...game.combat,
                lastAttack: null,
                enemies: [],
                projectiles: [
                  { id: "enemy-pose", art: 0, rank: "normal", origin: 7, distance: 5, damage: 5 },
                ],
                playerProjectiles: [
                  {
                    id: "pose",
                    dinosaur,
                    x: 200,
                    y: 200,
                    vx: 240,
                    vy: 0,
                    age: step * 80,
                    travelled: 0,
                    damage: 20,
                    critical: false,
                  },
                ],
              },
            },
          });
        },
        { dinosaur, step },
      );
      const shot = page.locator(".player-projectile");
      await expect(shot.locator("canvas")).toHaveAttribute("data-frame", String(frame));
      const sizes = await page.evaluate(() => {
        const player = JSON.parse(
          document.querySelector(".player-projectile")!.getAttribute("data-hitbox")!,
        );
        const enemy = document.querySelector<HTMLElement>(".enemy-projectile")!.style;
        return [player.width / parseFloat(enemy.width), player.height / parseFloat(enemy.height)];
      });
      const size = Math.max(...sizes);
      if (step === 0) expect(size).toBeCloseTo(1.2, 5);
      if (step > 0 && step <= 10) expect(size).toBeGreaterThan(previousSize);
      if (step >= 10) expect(size).toBeCloseTo(2.4, 5);
      previousSize = size;
      const box = JSON.parse((await shot.getAttribute("data-hitbox"))!);
      expect(box.x + box.width / 2).toBeCloseTo(200, 5);
      expect(box.y + box.height / 2).toBeCloseTo(200, 5);
      const rect = page.locator('[data-debug-projectile="pose"] rect');
      for (const [key, value] of Object.entries(box))
        await expect(rect).toHaveAttribute(key, String(value));
      await expect
        .poll(() =>
          shot.evaluate((node) => {
            const hit = JSON.parse(node.getAttribute("data-hitbox")!);
            const arena = node.closest(".design-canvas-inner")!.getBoundingClientRect();
            const scale = arena.width / 354,
              canvas = node.querySelector("canvas")!.getBoundingClientRect();
            return Math.max(
              Math.abs(canvas.x - arena.x - hit.x * scale),
              Math.abs(canvas.y - arena.y - hit.y * scale),
              Math.abs(canvas.width - hit.width * scale),
              Math.abs(canvas.height - hit.height * scale),
            );
          }),
        )
        .toBeLessThan(0.2);
    }
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
    "기간",
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
  await expect(page.locator(".trend-column")).toHaveCount(9);
  await expect(page.locator(".health-trend")).toContainText("+26점");
  await page.getByRole("combobox", { name: "건강 변화 조회 기간" }).selectOption("week");
  await expect(page.locator(".impact-card")).toBeVisible();
});

test("account controls, top notices and step guidance keep dialogs separate", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, "Notification", {
      value: class {
        static permission = "default";
        static async requestPermission() {
          throw new Error("Notification permission unavailable");
        }
      },
    });
  });
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
  await expect(page.getByRole("switch", { name: "일일 상태 초기화 안내" })).toHaveCount(0);
  await page.getByRole("button", { name: /알림 설정/ }).click();
  await page.getByRole("button", { name: "브라우저 알림 켜기" }).click();
  await page.keyboard.press("Escape");
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
  const player = JSON.parse((await page.locator(".battle-dinosaur").getAttribute("data-hitbox"))!);
  expect(player.y + player.height / 2).toBeCloseTo(188.8, 2);
  const points = await page.locator('[data-series="today"]').getAttribute("points");
  const vertices = points!.split(" ").map((p) => p.split(",").map(Number));
  expect(vertices).toHaveLength(6);
  await expect(page.locator(".radar-point")).toHaveCount(6);
});
