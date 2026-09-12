import { expect, test } from "@playwright/test";

const OUT = "/Users/jsanders/Claude/os-erp-projects/arag-voice/docs/screenshots";
const TOKEN = "e2e-admin-token";

test.use({ viewport: { width: 1440, height: 1000 } });

test("before: console", async ({ page }) => {
  await page.goto("/");
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${OUT}/before-01-live.png`, fullPage: true });

  await page.fill(
    "#typedTurn",
    "caller: we run a machine shop and we print stainless steel brackets\n" +
      "caller: the sintering step with the PureSinter furnace is what we need to understand",
  );
  await page.click("#sendTurn");
  await expect(page.locator("#briefSources .arag-cite").first()).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${OUT}/before-02-live-session.png`, fullPage: true });

  await page.click('[data-tab="ask"]');
  await page.fill("#question", "Tell me about the Desktop Metal PureSinter furnace.");
  await page.click("#ask");
  await expect(page.locator(".arag-bubble.assistant").last()).toContainText(/sinter/i, { timeout: 30_000 });
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${OUT}/before-03-ask.png`, fullPage: true });

  await page.click('[data-tab="golden"]');
  await page.click("#runGolden2");
  await expect(page.locator("#goldenTable tbody tr").first()).toBeVisible({ timeout: 90_000 });
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${OUT}/before-04-golden.png`, fullPage: true });

  await page.click('[data-tab="call"]');
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/before-05-call.png`, fullPage: true });
});

test("before: admin", async ({ page, request }) => {
  const created = await request.post("/api/v1/listen/sessions", { data: { prospect: "progress" } });
  const { id } = (await created.json()) as { id: string };
  await request.post(`/api/v1/listen/sessions/${id}/transcript`, {
    data: {
      chunks: [{ speaker: "caller", text: "we print stainless steel brackets and need a sintering furnace" }],
    },
  });
  await request.post("/api/v1/voice-answer", {
    data: { prospect: "progress", question: "What is binder jetting?" },
  });

  await page.goto("/admin/");
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${OUT}/before-06-admin-signin.png`, fullPage: true });
  await page.fill("#token", TOKEN);
  await page.click("#signin");
  await expect(page.locator("#panel")).toBeVisible();
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${OUT}/before-07-admin-overview.png`, fullPage: true });

  await page.click('[data-tab="prospects"]');
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${OUT}/before-08-admin-prospects.png`, fullPage: true });

  await page.click('[data-tab="listen"]');
  await page.click("#reloadListen");
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${OUT}/before-09-admin-listen-sessions.png`, fullPage: true });

  await page.click('[data-tab="turns"]');
  await page.click("#reloadTurns");
  await page.waitForTimeout(1000);
  await page.screenshot({ path: `${OUT}/before-10-admin-turns.png`, fullPage: true });

  await page.click('[data-tab="config"]');
  await page.waitForTimeout(1000);
  await page.screenshot({ path: `${OUT}/before-11-admin-config.png`, fullPage: true });
});
