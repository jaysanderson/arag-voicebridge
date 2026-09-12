import { expect, test } from "@playwright/test";

test.describe("voice console", () => {
  test("builds a live brief from a typed conversation, with citations", async ({ page }) => {
    await page.goto("/");
    // Listen is the hero path and the default tab.
    await expect(page.locator('#modeTabs [role="tab"][aria-selected="true"]')).toContainText("Listen");
    await expect(page.locator('[data-panel="listen"]')).toBeVisible();

    await page.fill(
      "#typedTurn",
      "caller: we run a machine shop and we print stainless steel brackets\n" +
        "caller: the sintering step with the PureSinter furnace is what we need to understand",
    );
    await page.click("#sendTurn");

    await expect(page.locator("#listenChip")).toHaveText("listening", { timeout: 20_000 });
    await expect(page.locator("#briefBody")).not.toContainText("The brief appears here", { timeout: 20_000 });
    await expect(page.locator("#briefSources .arag-cite").first()).toBeVisible({ timeout: 20_000 });
    await expect(page.locator("#briefMeta")).toContainText("updated live");
    await expect(page.locator("#statRefreshes")).not.toHaveText("—");
    await expect(page.locator("#transcript")).toContainText("machine shop");
  });

  test("plays the sample conversation and evolves the brief", async ({ page }) => {
    await page.goto("/");
    await page.click("#sampleBtn");
    await expect(page.locator("#sampleBtn")).toHaveText("Stop sample");
    await expect(page.locator("#briefSources .arag-cite").first()).toBeVisible({ timeout: 30_000 });
    const version = page.locator("#briefMeta .version");
    await expect(version).toBeVisible({ timeout: 30_000 });
    await page.click("#sampleBtn");
    await expect(page.locator("#sampleBtn")).toHaveText("Play sample conversation");
    await page.click("#endBtn");
    await expect(page.locator("#listenChip")).toHaveText("no session");
  });

  test("throttling is reported back to the client", async ({ page }) => {
    await page.goto("/");
    await page.fill("#typedTurn", "caller: we print stainless steel brackets and manifolds every week");
    await page.click("#sendTurn");
    await expect(page.locator("#sendHint")).toContainText("brief refreshing", { timeout: 20_000 });
    await page.fill("#typedTurn", "caller: and we also print a few titanium parts");
    await page.click("#sendTurn");
    await expect(page.locator("#sendHint")).toContainText(/queued|skipped/, { timeout: 20_000 });
  });

  test("answers a grounded question end to end with citations and latency", async ({ page }) => {
    await page.goto("/");
    await page.click('[data-tab="ask"]');
    await expect(page.locator("arag-shell .product")).toContainText("VoiceBridge");
    await expect(page.locator("#prospect")).toHaveValue("progress");

    await page.fill("#question", "Tell me about the Desktop Metal PureSinter furnace.");
    await page.click("#ask");

    const answer = page.locator(".arag-bubble.assistant").last();
    await expect(answer).toContainText(/sinter/i, { timeout: 20_000 });
    await expect(answer.locator(".arag-chip.ok")).toHaveText("answered");
    await expect(answer.locator(".arag-cite").first()).toBeVisible();
    await expect(page.locator("#factTotal")).not.toHaveText("—");
    await expect(page.locator("#pipelineSteps li.ok").first()).toBeVisible();
  });

  test("hands off an out-of-scope question instead of guessing", async ({ page }) => {
    await page.goto("/");
    await page.click('[data-tab="ask"]');
    await page.fill("#question", "What is the capital of France?");
    await page.click("#ask");
    const answer = page.locator(".arag-bubble.assistant").last();
    await expect(answer.locator(".arag-chip.warn")).toContainText("handoff", { timeout: 20_000 });
    await expect(answer).toContainText("specialist");
  });

  test("suggested questions are wired to the pipeline", async ({ page }) => {
    await page.goto("/");
    await page.click('[data-tab="ask"]');
    await page.locator("#suggestions button").first().click();
    await expect(page.locator(".arag-bubble.assistant").last()).not.toContainText("Thinking…", {
      timeout: 20_000,
    });
  });

  test("runs the golden set and opens the demo gate", async ({ page }) => {
    await page.goto("/");
    await page.click("#runGolden");
    await expect(page.locator("#goldenChip")).toHaveText("gate open", { timeout: 60_000 });
    await expect(page.locator("#goldenSummary")).toContainText("10/10 passed");
    await expect(page.locator("#goldenTable tbody tr")).toHaveCount(10);
  });

  test("shows live metrics in the footer", async ({ page }) => {
    await page.goto("/");
    await page.click('[data-tab="ask"]');
    await page.fill("#question", "What is binder jetting?");
    await page.click("#ask");
    await expect(page.locator("#mBridge")).toHaveText("online", { timeout: 20_000 });
    await expect(page.locator("#mTurns")).not.toHaveText("—");
  });

  test("switching tabs actually hides the other panels", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator('[data-panel="listen"]')).toBeVisible();
    await expect(page.locator('[data-panel="call"]')).toBeHidden();
    await page.click('[data-tab="call"]');
    await expect(page.locator('[data-panel="call"]')).toBeVisible();
    await expect(page.locator('[data-panel="listen"]')).toBeHidden();
    await expect(page.locator('[data-panel="golden"]')).toBeHidden();
  });

  test("call and listen tabs degrade politely without ElevenLabs credentials", async ({ page }) => {
    await page.goto("/");
    await page.click('[data-tab="call"]');
    await expect(page.locator("#callBtn")).toBeVisible();
    await page.click("#callBtn");
    await expect(page.locator("#callStatus")).toContainText(/No ElevenLabs agent configured|error/i);
    await page.click('[data-tab="listen"]');
    await expect(page.locator("#listenBtn")).toBeVisible();
  });
});
