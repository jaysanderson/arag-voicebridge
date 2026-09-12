import { expect, test } from "@playwright/test";

test.describe("voice console", () => {
  test("answers a grounded question end to end with citations and latency", async ({ page }) => {
    await page.goto("/");
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
    await page.fill("#question", "What is the capital of France?");
    await page.click("#ask");
    const answer = page.locator(".arag-bubble.assistant").last();
    await expect(answer.locator(".arag-chip.warn")).toContainText("handoff", { timeout: 20_000 });
    await expect(answer).toContainText("specialist");
  });

  test("suggested questions are wired to the pipeline", async ({ page }) => {
    await page.goto("/");
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
    await page.fill("#question", "What is binder jetting?");
    await page.click("#ask");
    await expect(page.locator("#mBridge")).toHaveText("online", { timeout: 20_000 });
    await expect(page.locator("#mTurns")).not.toHaveText("—");
  });

  test("switching tabs actually hides the other panels", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator('[data-panel="ask"]')).toBeVisible();
    await expect(page.locator('[data-panel="call"]')).toBeHidden();
    await page.click('[data-tab="call"]');
    await expect(page.locator('[data-panel="call"]')).toBeVisible();
    await expect(page.locator('[data-panel="ask"]')).toBeHidden();
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
