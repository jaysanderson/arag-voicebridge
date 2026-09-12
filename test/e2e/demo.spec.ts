import { expect, type Page, test } from "@playwright/test";

/**
 * The Live workspace — the product's hero. These journeys follow what a person actually does:
 * arrive for the first time, start listening from a source, read the brief as it evolves, and
 * end the session so it is kept.
 */

/**
 * A fresh browser has never seen the product: the first-run guidance is part of the journey.
 * Cleared after the first load rather than in an init script, so a later reload in the same test
 * still sees whatever the page itself stored.
 */
async function firstRun(page: Page) {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.reload();
}

/** A returning user: onboarding dismissed, straight into the workspace. */
async function returning(page: Page) {
  await page.addInitScript(() => localStorage.setItem("vb.onboarded", "1"));
  await page.goto("/");
}

test.describe("Live", () => {
  test("first run offers the sample conversation and explains what the product will not do", async ({
    page,
  }) => {
    await firstRun(page);
    await expect(page.locator("#vbOnboard")).toBeVisible();
    await expect(page.locator("#vbOnboard")).toContainText("The right answer, while you are still talking");
    await expect(page.locator("#vbOnboard")).toContainText("It never speaks");
    await expect(page.locator("#vbSampleOnboard")).toBeVisible();

    await page.click("#vbDismissOnboard");
    await expect(page.locator("#vbOnboard")).toHaveCount(0);
    // The choice is remembered, so the banner does not greet a returning user again.
    await page.reload();
    await expect(page.locator("#vbOnboard")).toHaveCount(0);
  });

  test("the empty workspace teaches, and offers all three transcript sources", async ({ page }) => {
    await returning(page);
    await expect(page.locator("#vbBrief")).toContainText("The brief appears here");
    await expect(page.locator("#vbMic")).toBeVisible();
    await expect(page.locator("#vbWebhook")).toBeVisible();
    await expect(page.locator("#vbTypeHere")).toBeVisible();
    // No ElevenLabs key on this deployment: the microphone says why rather than failing later.
    await expect(page.locator("#vbMic")).toBeDisabled();
    await expect(page.locator("#vbMic")).toContainText("Needs an ElevenLabs key");
  });

  test("builds a live brief from a typed conversation, with citations", async ({ page }) => {
    await returning(page);
    await page.fill(
      "#vbTyped",
      "caller: we run a machine shop and we print stainless steel brackets\n" +
        "caller: the sintering step with the PureSinter furnace is what we need to understand",
    );
    await page.click("#vbSend");

    await expect(page.locator("#vbSessionChip")).toHaveText("listening", { timeout: 20_000 });
    await expect(page.locator("#vbBrief .vb-brief")).toBeVisible({ timeout: 20_000 });
    await expect(page.locator("#vbSources .arag-cite").first()).toBeVisible({ timeout: 20_000 });
    await expect(page.locator("#vbBriefMeta")).toContainText("updated live");
    await expect(page.locator("#vbStats")).toContainText("Brief refreshes");
    await expect(page.locator("#vbTranscript")).toContainText("machine shop");
  });

  test("the telephony webhook option explains the integration without leaving the page", async ({ page }) => {
    await returning(page);
    await page.click("#vbWebhook");
    const drawer = page.locator(".vb-drawer");
    await expect(drawer).toBeVisible();
    await expect(drawer).toContainText("/api/v1/listen/sessions");
    await expect(drawer).toContainText("transcript");
    await page.keyboard.press("Escape");
    await expect(drawer).toHaveCount(0);
  });

  test("plays the sample conversation, evolves the brief, then ends and keeps it", async ({ page }) => {
    await returning(page);
    await page.click("#vbSample");
    await expect(page.locator("#vbSources .arag-cite").first()).toBeVisible({ timeout: 30_000 });
    await expect(page.locator("#vbBriefMeta .version")).toBeVisible({ timeout: 30_000 });

    await page.click("#vbEnd");
    await expect(page.locator("#vbSessionChip")).toHaveText("ended", { timeout: 20_000 });
    // Ending is not losing: the session is kept and reachable from Conversations.
    await expect(page.locator("#vbSessionBody")).toContainText("Open in Conversations");
    await expect(page.locator("#vbBrief .vb-brief")).toBeVisible();
  });

  test("a degraded refresh leaves the last good brief on screen", async ({ page }) => {
    await returning(page);
    await page.fill(
      "#vbTyped",
      "caller: we run a machine shop and we print stainless steel brackets\n" +
        "caller: the sintering step with the PureSinter furnace is what we need to understand",
    );
    await page.click("#vbSend");
    await expect(page.locator("#vbBrief .vb-brief")).toBeVisible({ timeout: 20_000 });
    const good = (await page.locator("#vbBrief .vb-brief").innerText()).trim();
    expect(good.length).toBeGreaterThan(0);

    // Degrade every subsequent read of the session: no brief, version 0. The promise is that the
    // pane keeps showing the last good brief rather than blanking — no error, no toast, no red.
    await page.route("**/api/v1/listen/sessions/*?transcript_tail=*", async (route) => {
      const res = await route.fetch();
      const body = await res.json();
      await route.fulfill({
        response: res,
        json: { ...body, brief: null, briefVersion: 0, citations: [] },
      });
    });
    // Drive the page's own reconciliation, then let its poll run at least once.
    await page.fill("#vbTyped", "caller: and we also print a few titanium parts");
    await page.click("#vbSend");
    await page.waitForTimeout(4000);

    await expect(page.locator("#vbBrief .vb-brief")).toBeVisible();
    expect((await page.locator("#vbBrief .vb-brief").innerText()).trim()).toBe(good);
    await expect(page.locator("#vbSources .arag-cite").first()).toBeVisible();
    await expect(page.locator(".arag-alert.error")).toHaveCount(0);
    await expect(page.locator(".arag-toast")).toHaveCount(0);
  });

  test("a failed refresh reads as staleness with a retry, not as an error", async ({ page }) => {
    await returning(page);
    // Stand in for the server's own "that refresh found nothing" signal. Everything else — the
    // session, the brief, the citations — is real and arrives over the polling path.
    await page.route("**/api/v1/listen/sessions/*/events", (route) =>
      route.fulfill({
        status: 200,
        headers: { "content-type": "text/event-stream", "cache-control": "no-cache" },
        body: 'event: status\ndata: {"type":"status","status":"skipped","reason":"refresh-failed"}\n\n',
      }),
    );
    await page.fill("#vbTyped", "caller: we print stainless steel brackets and need a sintering furnace");
    await page.click("#vbSend");

    await expect(page.locator("#vbBrief .vb-brief")).toBeVisible({ timeout: 20_000 });
    await expect(page.locator(".vb-stale")).toBeVisible({ timeout: 20_000 });
    await expect(page.locator(".vb-stale")).toContainText("showing the last good brief");
    await expect(page.locator(".arag-alert.error")).toHaveCount(0);

    // The retry is offered, never taken automatically: appending transcript to force a refresh
    // would fabricate words nobody said.
    const retry = page.locator("#vbRetry");
    await expect(retry).toBeVisible();
    const before = await page.locator("#vbTranscript .line").count();
    await retry.click();
    await expect(page.locator("#vbBrief .vb-brief")).toBeVisible();
    await page.waitForTimeout(800);
    expect(await page.locator("#vbTranscript .line").count()).toBe(before);
  });

  test("the throttle tells the client what it did with an append", async ({ page }) => {
    await returning(page);
    await page.fill("#vbTyped", "caller: we print stainless steel brackets and manifolds every week");
    await page.click("#vbSend");
    await expect(page.locator("#vbSendHint")).toContainText("brief refreshing", { timeout: 20_000 });
    await page.fill("#vbTyped", "caller: and we also print a few titanium parts");
    await page.click("#vbSend");
    await expect(page.locator("#vbSendHint")).toContainText(/queued|skipped/, { timeout: 20_000 });
  });

  test("the voice-agent call is a tool inside Live, not a destination", async ({ page }) => {
    await returning(page);
    await expect(page.locator("nav.vb-nav")).not.toContainText("Call");
    await page.click("#vbCallTool");
    await expect(page.locator(".vb-drawer")).toContainText("Start a voice call");
    // No agent configured in the mock deployment: it says so instead of failing on click.
    await expect(page.locator("#vbCallStatus")).toContainText("No voice agent is configured");
  });

  test("the workspace navigation reaches every section", async ({ page }) => {
    await returning(page);
    for (const [label, heading] of [
      ["Conversations", "Conversations"],
      ["Knowledge", "Knowledge"],
      ["Prospects", "Prospects"],
      ["Quality", "Quality"],
      ["Settings", "Settings"],
    ] as const) {
      await page.click(`nav.vb-nav a:has-text("${label}")`);
      await expect(page.locator("h1")).toHaveText(heading);
      await expect(page.locator(`nav.vb-nav a[aria-current="page"]`)).toContainText(label);
    }
  });
});
