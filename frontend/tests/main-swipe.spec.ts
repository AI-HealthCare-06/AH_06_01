import { expect, test, type Page } from "@playwright/test";

test.use({ isMobile: true, hasTouch: true, viewport: { width: 412, height: 892 } });

async function fingerSwipe(page: Page, selector: string, dx: number, dy = 0) {
  await expect(page.locator("html")).not.toHaveAttribute("data-main-tab-motion");
  const route = new URL(page.url()).pathname.split("/")[1];
  const target = page.locator(`.${route}-screen ${selector}`);
  await expect(target).toBeVisible();
  await target.evaluate((element) =>
    element.scrollIntoView({ block: "center", inline: "nearest", behavior: "instant" }),
  );
  const box = (await target.boundingBox())!;
  const viewport = page.viewportSize()!;
  const left = Math.max(20, box.x),
    right = Math.min(viewport.width - 20, box.x + box.width);
  const top = Math.max(0, box.y),
    bottom = Math.min(viewport.height - 90, box.y + box.height);
  expect(right).toBeGreaterThan(left);
  expect(bottom).toBeGreaterThan(top);
  const x = left + (right - left) * (dx < 0 ? 0.8 : 0.2);
  const y = (top + bottom) / 2;
  const touch = await page.context().newCDPSession(page);
  try {
    await touch.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ x, y }],
    });
    for (let step = 1; step <= 12; step++) {
      // Preserve a real finger-drag duration so the browser also performs native scrolling.
      await new Promise((resolve) => setTimeout(resolve, 20));
      await touch.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [{ x: x + (dx * step) / 12, y: y + (dy * step) / 12 }],
      });
    }
    await touch.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  } finally {
    await touch.detach();
  }
}

test("real touch swipes switch main tabs in both directions despite modest vertical drift", async ({
  page,
}) => {
  await page.goto("/home");
  await fingerSwipe(page, ".greeting", -240, 55);
  await expect(page).toHaveURL(/\/quests$/);
  await fingerSwipe(page, ".greeting", 240, 45);
  await expect(page).toHaveURL(/\/home$/);
  await fingerSwipe(page, ".greeting", 240);
  await expect(page).toHaveURL(/\/character$/);
  await fingerSwipe(page, ".greeting", 240);
  await expect(page).toHaveURL(/\/shop$/);
  await fingerSwipe(page, ".greeting", 240);
  await expect(page).toHaveURL(/\/shop$/);
  for (const path of ["character", "home", "quests", "dashboard"]) {
    await fingerSwipe(page, ".greeting", -240);
    await expect(page).toHaveURL(new RegExp(`/${path}$`));
  }
  await fingerSwipe(page, ".greeting", -240);
  await expect(page).toHaveURL(/\/dashboard$/);
});

test("real vertical scroll and skin-carousel swipes do not switch the main tab", async ({
  page,
}) => {
  await page.goto("/shop");
  await fingerSwipe(page, ".product-scroll", 15, -140);
  await expect(page).toHaveURL(/\/shop$/);
  await expect
    .poll(() =>
      page
        .locator(".shop-screen .main-content")
        .evaluate((screen) =>
          Math.max(
            screen.scrollTop,
            ...Array.from(screen.querySelectorAll("*")).map((e) => e.scrollTop),
          ),
        ),
    )
    .toBeGreaterThan(0);
  await page.goto("/character");
  const skin = page.getByLabel("현재 스킨");
  await expect(skin).toContainText("SKIN 1 / 9");
  await fingerSwipe(page, ".vault-skin-grid", -125);
  await expect(page).toHaveURL(/\/character$/);
  await expect(skin).not.toContainText("SKIN 1 / 9");
});

test("swiping dinosaur preview and battle content changes the main tab", async ({ page }) => {
  await page.goto("/character");
  await fingerSwipe(page, ".vault-hero-stage", -180, 45);
  await expect(page).toHaveURL(/\/home$/);
  await fingerSwipe(page, ".battle-scenery", -180, 40);
  await expect(page).toHaveURL(/\/quests$/);
});

test("tab slides show both pages in the swipe direction while shared controls stay in place", async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/home");
  await expect(page.locator(".home-screen")).toBeVisible();
  const header = (await page.locator(".greeting").boundingBox())!;
  const navigation = (await page.locator(".bottom-navigation").boundingBox())!;
  const width = (await page.locator(".main-screen").boundingBox())!.width;
  for (const dx of [-240, 240]) {
    // Freeze the real rendered transition so geometry and screenshots are deterministic.
    await page.evaluate(() => {
      const freeze = (event: AnimationEvent) => {
        if (event.animationName !== "tab-page-enter") return;
        document.removeEventListener("animationstart", freeze);
        for (const animation of document.getAnimations()) {
          if (
            animation instanceof CSSAnimation &&
            ["tab-page-enter", "tab-page-exit"].includes(animation.animationName)
          )
            animation.pause();
        }
      };
      document.addEventListener("animationstart", freeze);
    });
    await fingerSwipe(page, ".greeting", dx);
    await expect(page).toHaveURL(dx < 0 ? /\/quests$/ : /\/home$/);
    await expect(page.locator(dx < 0 ? ".quests-screen" : ".home-screen")).toBeVisible();
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            document
              .getAnimations()
              .filter(
                (a) =>
                  a instanceof CSSAnimation &&
                  ["tab-page-enter", "tab-page-exit"].includes(a.animationName) &&
                  a.playState === "paused",
              ).length,
        ),
      )
      .toBe(2);
    const frames = [];
    for (const time of [40, 100, 180]) {
      const frame = await page.evaluate((time) => {
        for (const animation of document.getAnimations()) {
          if (
            animation instanceof CSSAnimation &&
            ["tab-page-enter", "tab-page-exit"].includes(animation.animationName)
          )
            animation.currentTime = time;
        }
        const offset = (which: "old" | "new") =>
          new DOMMatrixReadOnly(
            getComputedStyle(document.documentElement, `::view-transition-${which}(main-tab-page)`)
              .transform,
          ).m41;
        return { time, outgoing: offset("old"), incoming: offset("new") };
      }, time);
      frames.push(frame);
      expect(frame.outgoing * Math.sign(dx)).toBeGreaterThan(0);
      expect(frame.incoming * Math.sign(dx)).toBeLessThan(0);
      expect(Math.abs(frame.incoming - frame.outgoing)).toBeCloseTo(width, 0);
      if (time === 100) {
        const path = testInfo.outputPath(`swipe-${dx < 0 ? "next" : "previous"}.png`);
        await page.screenshot({ path });
        await testInfo.attach(`swipe ${dx < 0 ? "next" : "previous"}`, {
          path,
          contentType: "image/png",
        });
      }
    }
    expect(Math.abs(frames[2].outgoing)).toBeGreaterThan(Math.abs(frames[0].outgoing));
    expect(await page.locator(".greeting").boundingBox()).toEqual(header);
    expect(await page.locator(".bottom-navigation").boundingBox()).toEqual(navigation);
    await expect(page.locator(".main-screen")).toHaveCount(1);
    await page.evaluate(() => {
      for (const animation of document.getAnimations()) {
        if (
          animation instanceof CSSAnimation &&
          ["tab-page-enter", "tab-page-exit"].includes(animation.animationName)
        )
          animation.play();
      }
    });
    await expect(page.locator("html")).not.toHaveAttribute("data-main-tab-motion");
  }
  expect(errors).toEqual([]);
});

test("short swipes, reduced motion and older WebViews keep navigation usable", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(document, "startViewTransition", { value: undefined });
  });
  await page.goto("/home");
  await fingerSwipe(page, ".greeting", -45);
  await expect(page).toHaveURL(/\/home$/);
  await fingerSwipe(page, ".greeting", -240);
  await expect(page).toHaveURL(/\/quests$/);
  await expect(page.locator(".main-content")).toHaveCSS("transform", "none");
  await expect(page.locator("html")).not.toHaveAttribute("data-main-tab-motion");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await fingerSwipe(page, ".greeting", 240);
  await expect(page).toHaveURL(/\/home$/);
  await expect(page.locator(".main-content")).toHaveCSS("transform", "none");
});
