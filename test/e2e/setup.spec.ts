/**
 * The onboarding wizard.
 *
 * The property worth pinning is not that the page renders — it is that every step's state is read
 * from the live configuration rather than from a "dismissed" flag, so a step that stops being true
 * comes back.
 */
import { expect, test } from "@playwright/test";

const ADMIN = { Authorization: "Bearer e2e-admin-token" };

test.describe("Set up", () => {
  test("lists the steps, marks what is done, and points at the next thing", async ({ page }) => {
    await page.goto("/setup/");
    await expect(page.locator(".vb-step").first()).toBeVisible({ timeout: 20_000 });

    // Every step the API returns is on the page, in order.
    const titles = await page.locator(".vb-step h3").allTextContents();
    expect(titles.length).toBeGreaterThanOrEqual(7);
    expect(titles[0]).toContain("Knowledge Box");

    // Running on the sample Knowledge Box, the first step is honestly not done — and because it is
    // the first required step that is not done, it is the one marked "next".
    await expect(page.locator("#setup-knowledge")).not.toHaveClass(/done/);
    await expect(page.locator(".vb-step.next h3")).toHaveText(/Knowledge Box/);

    // The registry is seeded, so that step is done.
    await expect(page.locator("#setup-prospect")).toHaveClass(/done/);

    // Optional steps say so, rather than looking like failures.
    await expect(page.locator("#setup-elevenlabs .arag-chip", { hasText: "optional" })).toBeVisible();

    // Progress is reported honestly.
    await expect(page.locator(".vb-setup-progress strong")).toContainText("required step");
  });

  test("each step links to the screen that does it", async ({ page }) => {
    await page.goto("/setup/");
    await expect(page.locator("#setup-apikey")).toBeVisible({ timeout: 20_000 });
    await page.click("#setup-apikey a.arag-btn");
    await expect(page).toHaveURL(/\/settings\/#api-keys$/);
  });

  /** The point of computing state live: do the thing, come back, the step has changed. */
  test("a step's state follows the deployment, not a dismissed flag", async ({ page, request }) => {
    await page.goto("/setup/");
    await expect(page.locator("#setup-apikey")).toBeVisible({ timeout: 20_000 });
    await expect(page.locator("#setup-apikey")).not.toHaveClass(/done/);
    await expect(page.locator("#setup-apikey .vb-step-foot .muted")).toContainText("open");

    const created = await request.post("/api/v1/admin/api-keys", {
      headers: ADMIN,
      data: { name: "Setup wizard check" },
    });
    const { key } = (await created.json()) as { key: { id: string } };

    await page.click("#setupRecheck");
    await expect(page.locator("#setup-apikey")).toHaveClass(/done/, { timeout: 20_000 });
    await expect(page.locator("#setup-apikey .vb-step-foot .muted")).toContainText("active key");

    // And it comes back when the key is revoked — a stored flag could not do this.
    await request.delete(`/api/v1/admin/api-keys/${key.id}`, { headers: ADMIN });
    await page.click("#setupRecheck");
    await expect(page.locator("#setup-apikey")).not.toHaveClass(/done/, { timeout: 20_000 });
  });

  test("the rail carries the count of what is still required", async ({ page }) => {
    await page.goto("/setup/");
    await expect(page.locator(".vb-step").first()).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('.arag-railnav a[data-nav="Set up"]')).toContainText("1");
  });
});
