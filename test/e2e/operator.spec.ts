/**
 * The two operator surfaces this pass added: a paged log, and deleting a conversation.
 */
import { expect, type Page, test } from "@playwright/test";

const ADMIN = { Authorization: "Bearer e2e-admin-token" };

async function signIn(page: Page, hash = "") {
  await page.goto(`/admin/${hash}`);
  if (await page.locator("#token").count()) {
    await page.fill("#token", "e2e-admin-token");
    await page.click("#signin");
  }
  await expect(page.locator(".arag-railnav")).toBeVisible({ timeout: 20_000 });
  if (hash) await page.goto(`/admin/${hash}`);
}

test.describe("operator: the log", () => {
  test("pages the ring rather than showing the last N", async ({ page, request }) => {
    // Make enough noise to need a second page. Every settings change is audited, so this is also
    // the audit trail the brief asks for.
    //
    // The field churned here is deliberately one no other spec asserts: this runs against the
    // shared deployment, and `workspace.spec.ts` checks the branding tagline in another worker.
    // Settings are deployment-wide, so a spec that changes one has to pick its target with that
    // in mind (or run its own instance, as `settings.spec.ts` does).
    for (let i = 0; i < 60; i++) {
      await request.patch("/api/v1/admin/settings", {
        headers: ADMIN,
        data: { limits: { maxHistoryTurns: (i % 20) + 1 } },
      });
    }
    await request.post("/api/v1/admin/settings/reset", { headers: ADMIN, data: { group: "limits" } });

    await signIn(page, "#logs");
    await expect(page.locator("#lgRange")).toBeVisible({ timeout: 20_000 });
    // Following is on by default, and the first page starts at the newest record.
    await expect(page.locator("#lgLive")).toBeChecked();
    await expect(page.locator("#lgPrev")).toBeDisabled();
    await expect(page.locator("#lgRange")).toContainText("1–");
    await expect(page.locator("#lgRange")).toContainText("ring holds");

    await expect(page.locator("#lgNext")).toBeEnabled();
    await page.click("#lgNext");
    await expect(page.locator("#lgRange")).toContainText("51–", { timeout: 10_000 });
    await expect(page.locator("#lgPrev")).toBeEnabled();
    // Paging away from the newest records means you are reading, not following.
    await expect(page.locator("#lgLive")).not.toBeChecked();

    await page.click("#lgPrev");
    await expect(page.locator("#lgRange")).toContainText("1–", { timeout: 10_000 });
  });

  test("the filter changes the total, not only the page", async ({ page }) => {
    await signIn(page, "#logs");
    await expect(page.locator("#lgCount")).toBeVisible({ timeout: 20_000 });
    const all = await page.locator("#lgCount").textContent();
    await page.fill("#lgContains", "settings.changed");
    await expect(page.locator("#lgCount")).not.toHaveText(all ?? "", { timeout: 10_000 });
    await expect(page.locator("#lgLog")).toContainText("settings.changed");
    await expect(page.locator("#lgRange")).toContainText("of");
  });

  /** Every operator change is audited with who, what and when — readable here, by an operator. */
  test("carries the audit trail for a settings change", async ({ page, request }) => {
    await request.patch("/api/v1/admin/settings", {
      headers: ADMIN,
      data: { limits: { maxHistoryTurns: 5 } },
    });
    await signIn(page, "#logs");
    await page.fill("#lgContains", "settings.changed");
    await expect(page.locator("#lgLog")).toContainText("limits.maxHistoryTurns", { timeout: 15_000 });
    await expect(page.locator("#lgLog")).toContainText("operator");
    await request.post("/api/v1/admin/settings/reset", { headers: ADMIN, data: { group: "limits" } });
  });

  test("carries the audit trail for a registry change too", async ({ page, request }) => {
    await request.post("/api/v1/admin/prospects", {
      headers: ADMIN,
      data: {
        key: "audit-check",
        config: {
          display_name: "Audit check",
          region: "europe-1",
          locale: "en-GB",
          greeting: "Hello",
          handoff_msg: "One moment",
        },
      },
    });
    await request.delete("/api/v1/admin/prospects/audit-check", { headers: ADMIN });

    await signIn(page, "#logs");
    await page.fill("#lgContains", "prospect.");
    await expect(page.locator("#lgLog")).toContainText("prospect.created", { timeout: 15_000 });
    await expect(page.locator("#lgLog")).toContainText("prospect.deleted");
    await expect(page.locator("#lgLog")).toContainText("audit-check");
    await expect(page.locator("#lgLog")).toContainText("operator");
  });
});

test.describe("operator: deleting a conversation", () => {
  test("deletes it, and everything recorded with it, behind a confirm", async ({ page, request }) => {
    const created = await request.post("/api/v1/listen/sessions", {
      headers: ADMIN,
      data: { prospect: "progress" },
    });
    const { id } = (await created.json()) as { id: string };
    await request.post(`/api/v1/listen/sessions/${id}/transcript`, {
      headers: ADMIN,
      data: { chunks: [{ speaker: "caller", text: "Something a real caller said." }] },
    });

    await signIn(page, "#sessions");
    const row = page.locator(`tr[data-session="${id}"]`);
    await expect(row).toBeVisible({ timeout: 20_000 });

    await row.locator("[data-delete]").click();
    const confirm = page.locator(".arag-confirm");
    await expect(confirm).toBeVisible();
    await expect(confirm).toContainText("transcript");
    await expect(confirm).toContainText("cannot be undone");

    await confirm.getByRole("button", { name: "Delete the conversation" }).click();
    await expect(row).toHaveCount(0, { timeout: 20_000 });

    // Gone from the server too, not only from the table.
    expect((await request.get(`/api/v1/listen/sessions/${id}`, { headers: ADMIN })).status()).toBe(404);
  });

  test("cancelling leaves the conversation alone", async ({ page, request }) => {
    const created = await request.post("/api/v1/listen/sessions", {
      headers: ADMIN,
      data: { prospect: "progress" },
    });
    const { id } = (await created.json()) as { id: string };

    await signIn(page, "#sessions");
    const row = page.locator(`tr[data-session="${id}"]`);
    await expect(row).toBeVisible({ timeout: 20_000 });
    await row.locator("[data-delete]").click();
    await expect(page.locator(".arag-confirm")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.locator(".arag-confirm")).toHaveCount(0);
    await expect(row).toBeVisible();
    expect((await request.get(`/api/v1/listen/sessions/${id}`, { headers: ADMIN })).status()).toBe(200);

    await request.delete(`/api/v1/admin/listen-sessions/${id}`, { headers: ADMIN });
  });
});
