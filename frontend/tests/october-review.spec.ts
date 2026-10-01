import { test, expect } from "@playwright/test";

test("system notification permission is requested only from the settings button", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Reflect.set(window, "permissionRequests", 0);
    Object.defineProperty(window, "Notification", {
      value: class {
        static permission = "default";
        static async requestPermission() {
          Reflect.set(window, "permissionRequests", Reflect.get(window, "permissionRequests") + 1);
          this.permission = "granted";
          return "granted";
        }
      },
    });
  });
  await page.goto("/me");
  await page.getByRole("button", { name: /알림 설정/ }).click();
  expect(await page.evaluate(() => Reflect.get(window, "permissionRequests"))).toBe(0);
  await page.getByRole("button", { name: "브라우저 알림 켜기" }).click();
  await expect(page.getByRole("button", { name: "브라우저 알림 허용됨" })).toBeDisabled();
  expect(await page.evaluate(() => Reflect.get(window, "permissionRequests"))).toBe(1);
});

test("onboarding runs once, health edits save straight home, and later logins skip selection", async ({
  page,
}) => {
  await page.goto("/login");
  await page.getByRole("button", { name: "다음", exact: true }).click();
  await expect(page.locator(".profile-title-row")).toContainText("STEP 01");
  await page.getByRole("button", { name: "공룡 깨우기" }).click();
  await expect(page).toHaveURL(/\/dinosaur$/);
  await page.getByRole("button", { name: /스테고/ }).click();
  await page.getByRole("link", { name: "모험 시작하기" }).click();
  await page.getByRole("link", { name: "첫 퀘스트 시작하기" }).click();
  await expect(page).toHaveURL(/\/home$/);
  await page.goto("/me");
  await page.getByRole("button", { name: /건강 정보 수정/ }).click();
  await expect(page.locator(".profile-title-row")).not.toContainText("STEP 01");
  await page.getByRole("spinbutton", { name: "나이", exact: true }).fill("46");
  await page.getByRole("button", { name: "변경 저장하고 홈으로" }).click();
  await expect(page).toHaveURL(/\/home$/);
  await expect(page.locator(".feedback-copy")).toContainText("스테고");
  const profile = await page.evaluate(async () => {
    const path = "/src/stores/profile-store.ts";
    const { useProfileStore } = await import(path);
    return useProfileStore.getState().profile.age;
  });
  expect(profile).toBe(46);
  for (const route of ["dinosaur", "first-result"]) {
    await page.goto(`/${route}`);
    await expect(page).toHaveURL(/\/home$/);
  }
  await page.goto("/login");
  await page.getByRole("button", { name: "다음", exact: true }).click();
  await expect(page).toHaveURL(/\/home$/);
  await page.goto("/me");
  await page.getByRole("button", { name: "로그아웃" }).click();
  await page.getByRole("button", { name: "다음", exact: true }).click();
  await expect(page).toHaveURL(/\/home$/);
  const saved = await page.evaluate(() => JSON.stringify(localStorage));
  for (const key of ["bloodPressure", "height", "weight", "glucose", "rexrun12"])
    expect(saved).not.toContain(key);
});

test("failed wave sends one alert, OFF persists and holds combat until a manual retry", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const notifications: { title: string; body: string }[] = [];
    Reflect.set(window, "battleNotifications", notifications);
    Object.defineProperty(window, "Notification", {
      value: class {
        static permission = "granted";
        constructor(title: string, options: NotificationOptions) {
          notifications.push({ title, body: options.body ?? "" });
        }
      },
    });
  });
  await page.clock.install({ time: new Date("2026-10-01T03:00:00Z") });
  await page.clock.pauseAt(new Date("2026-10-01T03:00:01Z"));
  await page.goto("/me");
  const setting = page.getByRole("switch", { name: "Wave 자동 재시작", exact: true });
  await expect(setting).toBeChecked();
  await setting.click();
  await expect(setting).not.toBeChecked();
  await page.goto("/home");
  await page.evaluate(async () => {
    const path = "/src/stores/game-store.ts";
    const { useGameStore } = await import(path);
    useGameStore.setState(({ game }: { game: { combat: object } }) => ({
      paused: false,
      game: {
        ...game,
        dinosaur: 3,
        battlePaused: false,
        battleUpdatedAt: Date.now(),
        combat: {
          ...game.combat,
          clock: 0,
          stage: 1,
          wave: 2,
          hp: 1,
          lastFailure: null,
          recovery: 0,
          pendingGold: 0,
          spawned: 1,
          spawnIn: 5000,
          attackIn: 5000,
          transition: null,
          playerProjectiles: [],
          projectiles: [],
          enemies: [
            {
              id: 1,
              art: 0,
              rank: "normal",
              hp: 100,
              maxHp: 100,
              ad: 1000,
              distance: 0,
              attackIn: 0,
              ranged: false,
              hitAt: -1000,
            },
          ],
        },
      },
    }));
  });
  await page.clock.runFor(50);
  await expect(page.locator(".battle-recovery")).toContainText("자동 재시작 OFF");
  await expect(page.locator(".feedback-copy")).toContainText("스테고: 잠깐 쉬어가도 괜찮아요!");
  await expect(page.locator(".notice")).toContainText("WAVE 2 클리어 실패");
  expect(await page.evaluate(() => Reflect.get(window, "battleNotifications"))).toHaveLength(1);
  expect(
    await page.evaluate(
      () => JSON.parse(localStorage.getItem("rexrun-demo-game-v1")!).combat.lastFailure,
    ),
  ).toMatchObject({ stage: 1, wave: 2, time: 50 });
  await page.clock.runFor(20000);
  await expect(page.locator(".battle-recovery")).toBeVisible();
  expect(await page.evaluate(() => Reflect.get(window, "battleNotifications"))).toHaveLength(1);
  await page.reload();
  await expect(page.locator(".battle-recovery")).toBeVisible();
  expect(await page.evaluate(() => Reflect.get(window, "battleNotifications"))).toHaveLength(0);
  await page.getByRole("button", { name: "다시 도전하기" }).click();
  await expect(page.locator(".battle-recovery")).toHaveCount(0);
  await expect(page.locator(".battle-start")).toBeVisible();
  await page.clock.runFor(1050);
  await expect(page.locator(".battle-start")).toHaveCount(0);
  await expect(page.locator(".battle-enemy")).toHaveCount(1);
});

test("dashboard filters sit above the week, range picker commits both dates, and numeric styles fit", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.clock.install({ time: new Date("2026-10-01T03:00:00Z") });
  for (const width of [320, 390, 534]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto("/dashboard");
    await expect(page.locator(".health-score")).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    const controls = (await page.locator(".dashboard-date-controls").boundingBox())!;
    const week = (await page.locator(".weekly-calendar").boundingBox())!;
    expect(controls.y + controls.height).toBeLessThanOrEqual(week.y);
    expect((await page.locator(".calendar-help-toggle svg").boundingBox())!.width).toBeCloseTo(
      19.8,
      1,
    );
    for (const selector of [
      ".trend-column strong",
      ".impact-card .risk-change small",
      ".impact-card .chart-axis",
      ".pixel-date-trigger",
    ]) {
      expect(
        await page
          .locator(selector)
          .first()
          .evaluate((node) => getComputedStyle(node).fontFamily),
      ).toContain("Press Start 2P");
    }
    await page.getByLabel("건강 변화 조회 기간").selectOption("custom");
    await page.getByRole("button", { name: "조회 날짜 범위" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("button", { name: "이전 달", exact: true }).click();
    await dialog.getByRole("button", { name: "2026년 9월 20일", exact: true }).click();
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "2026년 9월 30일", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.locator(".dashboard-range-label")).toHaveText("2026-09-20 ~ 2026-09-30");
    await expect(page.locator(".trend-column small").first()).toHaveText("09.20");
    await page.goto("/shop");
    await page.evaluate(async () => {
      const path = "/src/stores/game-store.ts";
      const { useGameStore } = await import(path);
      useGameStore.setState(({ game }: { game: object }) => ({ game: { ...game, gold: 22128 } }));
    });
    const gold = page.locator(".wallet-heading h3");
    const amount = page.locator(".wallet-balance > strong");
    expect(await gold.evaluate((node) => getComputedStyle(node).fontSize)).toBe(
      await amount.evaluate((node) => getComputedStyle(node).fontSize),
    );
    const a = (await gold.boundingBox())!,
      b = (await amount.boundingBox())!;
    expect(Math.abs(a.y + a.height / 2 - b.y - b.height / 2)).toBeLessThan(1);
    expect(b.x - (a.x + a.width)).toBeGreaterThanOrEqual(10);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      width,
    );
  }
});

test("today feedback reflects zero, partial and full quest completion", async ({ page }) => {
  await page.goto("/home");
  for (const [completed, title, count] of [
    [[], "오늘의 실천을 기다려요", "0/5"],
    [["medicine"], "조금씩 성장하고 있어요", "1/5"],
    [["medicine", "meal", "walk"], "오늘 잘하고 있어요", "3/5"],
    [["medicine", "meal", "walk", "water", "sleep"], "오늘 모두 해냈어요", "5/5"],
  ] as const) {
    await page.evaluate(async (completed) => {
      const path = "/src/stores/game-store.ts";
      const { useGameStore } = await import(path);
      useGameStore.setState(({ game }: { game: { combat: object } }) => ({
        paused: true,
        game: { ...game, completed, battlePaused: true, combat: { ...game.combat, recovery: 0 } },
      }));
    }, completed);
    await expect(page.locator(".feedback-copy")).toContainText(title);
    await expect(page.locator(".feedback-copy")).toContainText(count);
  }
});
