import { expect, test } from "@playwright/test";
import { BRANDED_URL } from "../../playwright.config.ts";

/**
 * Every API call this file makes carries the operator token.
 *
 * The suite runs several workers against one deployment, and one of them mints an API key — which
 * is exactly the product's documented behaviour: the moment a key exists, `/api/v1` requires one.
 * A test that relied on the deployment being open was relying on an accident of ordering.
 */
const ADMIN = { Authorization: "Bearer e2e-admin-token" };

/**
 * White-label check: a second instance of the same build, started with only BRAND_* variables
 * set, must present itself as the partner's product — no fork, no code change.
 */
test.describe("white-label branding", () => {
  test("the console wears the partner's name and hides the Progress credit", async ({ page }) => {
    await page.goto(`${BRANDED_URL}/`);
    await expect(page.locator("[data-brand-name]").first()).toHaveText("Contoso Live Assist");
    await expect(page.locator("[data-brand-tagline]").first()).toHaveText("grounded call context");
    await expect(page.locator("[data-powered-by]").first()).toBeHidden();
    await expect(page.locator("[data-brand-footer]").first()).toHaveText("© Contoso");
    const primary = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue("--arag-brand-600").trim(),
    );
    expect(primary).toBe("#6b2fa0");
  });

  test("the operator views are branded too", async ({ page }) => {
    await page.goto(`${BRANDED_URL}/admin/`);
    await page.fill("#token", "e2e-admin-token");
    await page.click("#signin");
    await expect(page.locator("[data-brand-name]").first()).toHaveText("Contoso Live Assist");
    await expect(page.locator("[data-powered-by]").first()).toBeHidden();
  });

  test("the unbranded deployment keeps the product name and the credit", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("[data-brand-name]").first()).toHaveText("VoiceBridge");
    await expect(page.locator("[data-powered-by]").first()).toBeVisible();
  });

  test("branding is served as public API", async ({ request }) => {
    const branded = await request.get(`${BRANDED_URL}/api/v1/branding`, { headers: ADMIN });
    expect(branded.status()).toBe(200);
    expect(await branded.json()).toMatchObject({ productName: "Contoso Live Assist", poweredBy: false });
    const plain = await request.get("/api/v1/branding", { headers: ADMIN });
    expect(await plain.json()).toMatchObject({ productName: "VoiceBridge", poweredBy: true });
  });
});
