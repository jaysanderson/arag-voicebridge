/**
 * No screen may scroll the page horizontally at any supported width. Tables, snippets and
 * diagrams scroll inside their own container; the document never does.
 *
 * Kept out of `make e2e` (whose testDir is test/e2e) because it is a layout regression check
 * rather than a journey. Run with:
 *   PW_TESTDIR=test/shots PW_DISABLE_TS_ESM=1 bunx playwright test responsive --workers=1
 */
import { expect, test } from "@playwright/test";

const WIDTHS = [1440, 1200, 1024, 768, 390];
const PAGES = ["/", "/conversations/", "/knowledge/", "/prospects/", "/quality/", "/settings/"];

for (const width of WIDTHS) {
  test(`no horizontal page scroll at ${width} px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    for (const path of PAGES) {
      await page.goto(path);
      await page.evaluate(() => localStorage.setItem("vb.onboarded", "1"));
      await page.goto(path);
      await page.waitForTimeout(700);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow, `${path} overflows by ${overflow}px`).toBeLessThanOrEqual(1);
    }
  });
}
