import { expect, type Page } from "@playwright/test";

export async function expectNoHorizontalOverflow(page: Page, selector = "html") {
  await page.evaluate(() => document.fonts.ready);
  const metrics = await page.locator(selector).evaluate((element) => {
    const bounds = element.getBoundingClientRect();
    return {
      width: element.clientWidth,
      scrollWidth: element.scrollWidth,
      offenders: [...element.querySelectorAll("*")]
        .map((child) => {
          const rect = child.getBoundingClientRect();
          return {
            tag: child.tagName,
            text: child.textContent?.slice(0, 40),
            parent: child.parentElement?.className,
            className: String(child.className),
            left: rect.left,
            right: rect.right,
            width: rect.width,
          };
        })
        .filter((child) => child.right > bounds.right + 0.1 || child.left < bounds.left - 0.1)
        .slice(0, 20),
    };
  });
  expect(metrics.scrollWidth, JSON.stringify(metrics, null, 2)).toBeLessThanOrEqual(metrics.width);
}
