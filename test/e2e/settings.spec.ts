import { spawn } from "node:child_process";
import { rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { expect, type Page, test } from "@playwright/test";

/**
 * Settings — every setting is editable in the product.
 *
 * The journeys here are the brief's: **edit → reload → the value persisted → the effect is
 * visible**. Branding proves it against the rail, limits against `GET /api/v1/admin/config`, and
 * the API key store against the key list and the one-time secret.
 *
 * This file runs against **its own instance of the product**, on its own port and its own
 * `DATA_DIR`. Settings are deployment-wide by definition: a spec that renames the product or turns
 * ElevenLabs on inside the shared e2e server would be changing the world out from under
 * `branding.spec.ts` and `workspace.spec.ts`, which run in parallel workers and assert the
 * opposite. An isolated instance is also a truer test — a restart of it would have to find the
 * stored overrides on disk.
 *
 * ElevenLabs is a **fake HTTP server started here**, reached by PATCHing `elevenlabs.apiBase`
 * through the product's own settings API — exactly the approach `test/integration.test.ts`
 * ("wiring the voice agent from the product") takes. The real ElevenLabs API is never called and
 * the live agent is never touched.
 */

const TOKEN = "e2e-admin-token";
const ADMIN = { Authorization: `Bearer ${TOKEN}` };
/** Off the two servers playwright.config.ts starts, so this file never collides with them. */
const PORT = Number(process.env.PW_SETTINGS_PORT ?? Number(process.env.PW_PORT ?? 8281) + 40);
const BASE = `http://127.0.0.1:${PORT}`;
const DATA_DIR = `./data/e2e-settings-page-${PORT}`;
/** The environment default this deployment boots with, so "reset to the environment" has a target. */
const ENV_TAGLINE = "grounded call context";

let server: ReturnType<typeof spawn> | null = null;

async function waitForHealth(timeoutMs = 30_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE}/healthz`);
      if (res.ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error(`the settings test server never came up on ${BASE}`);
}

test.beforeAll(async () => {
  rmSync(DATA_DIR, { recursive: true, force: true });
  server = spawn("node", ["src/index.ts"], {
    env: {
      ...process.env,
      ENV_FILE: "/dev/null",
      ARAG_MOCK: "1",
      ADMIN_TOKEN: TOKEN,
      DATA_DIR,
      LOG_LEVEL: "warn",
      RATE_LIMIT_RPS: "200",
      RATE_LIMIT_BURST: "400",
      PORT: String(PORT),
      BRAND_TAGLINE: ENV_TAGLINE,
    },
    stdio: "ignore",
  });
  await waitForHealth();
});

test.afterAll(async () => {
  server?.kill("SIGTERM");
  server = null;
});

/** Back to a clean deployment, so one journey cannot decide the next one's starting point. */
test.afterEach(async ({ request }) => {
  await request.post(`${BASE}/api/v1/admin/settings/reset`, { headers: ADMIN, data: {} });
});

/** The page as anyone sees it: read-only, with the unlock banner. */
async function openSettings(page: Page, hash = ""): Promise<void> {
  await page.goto(`${BASE}/settings/${hash}`);
  await expect(page.locator("#connection")).toBeVisible({ timeout: 20_000 });
}

/** Unlock the editing surface in place — the page never sends anyone to /admin/. */
async function unlock(page: Page, hash = ""): Promise<void> {
  await openSettings(page, hash);
  await page.fill("#stToken", TOKEN);
  await page.click("#stUnlock");
  await expect(page.locator('form[data-group="connection"]')).toBeVisible({ timeout: 20_000 });
}

const field = (group: string, key: string) => `.vb-set-field[data-field="${group}.${key}"]`;
const save = (group: string) => `form[data-group="${group}"] [data-save]`;
const status = (group: string) => `form[data-group="${group}"] [data-status]`;

// ── the shape of the screen ──────────────────────────────────────────────────

test.describe("the settings screen", () => {
  test("carries every section the onboarding wizard deep-links to", async ({ page }) => {
    for (const id of ["connection", "branding", "limits", "elevenlabs", "api-keys", "retention"]) {
      await page.goto(`${BASE}/settings/#${id}`);
      await expect(page.locator(`#${id}`)).toBeVisible({ timeout: 20_000 });
    }
    // The agent panel is a deep-link target of its own, inside the ElevenLabs section.
    await page.goto(`${BASE}/settings/#voice-agent`);
    await expect(page.locator("#voice-agent")).toBeVisible({ timeout: 20_000 });
    await expect(page.locator("#stAgent")).toContainText("voice_answer", { timeout: 20_000 });
  });

  test("renders read-only for anyone, and unlocks in place rather than sending you to /admin/", async ({
    page,
  }) => {
    await openSettings(page);
    await expect(page.locator("#stSignIn")).toContainText("read-only");
    await expect(page.locator("form[data-group]")).toHaveCount(0);
    // What it can read without a token, it still shows.
    await expect(page.locator("#stConnection")).toContainText("mock Knowledge Box", { timeout: 20_000 });
    await expect(page.locator("#stBrand")).toContainText("Progress default");

    await page.fill("#stToken", "not-the-token");
    await page.click("#stUnlock");
    await expect(page.locator("#stSignInError")).toContainText("not accepted");

    await page.fill("#stToken", TOKEN);
    await page.click("#stUnlock");
    await expect(page.locator('form[data-group="connection"]')).toBeVisible({ timeout: 20_000 });
    await expect(page.locator("#stSignIn")).toHaveCount(0);
  });

  test("renders every setting the API describes, in every group it describes", async ({ page, request }) => {
    const described = (await (
      await request.get(`${BASE}/api/v1/admin/settings`, { headers: ADMIN })
    ).json()) as { groups: Array<{ id: string; fields: Array<{ key: string }> }> };
    const total = described.groups.reduce((n, g) => n + g.fields.length, 0);

    await unlock(page);
    // Counts come from the API, never from this file: a group or a field added to SETTINGS_FIELDS
    // server-side has to appear here with no front-end change, and this is what proves it.
    await expect(page.locator(".vb-set-field")).toHaveCount(total);
    for (const g of described.groups) {
      await expect(page.locator(`#${g.id}`), `group ${g.id} has no section`).toHaveCount(1);
      await expect(page.locator(`[data-jump="${g.id}"]`), `group ${g.id} is not in the index`).toHaveCount(1);
    }
    // Spot-check that a field the server describes is really on screen, by its own key.
    await expect(page.locator(field("connection", "kbId"))).toBeVisible();
    await expect(page.locator(field("retention", "autoPurge"))).toBeVisible();
    // The generically-rendered group — no bespoke layout in settings.js — is editable like the rest.
    await expect(page.locator(field("operations", "logLevel"))).toBeVisible();
    await expect(page.locator(field("operations", "allowedOrigins"))).toBeVisible();
  });
});

// ── journey (a): branding ────────────────────────────────────────────────────

test.describe("branding", () => {
  test("edit → reload → persisted → the rail wears the new name", async ({ page, request }) => {
    await unlock(page, "#branding");
    const name = page.locator("#set-branding-productName");
    await expect(page.locator(field("branding", "productName"))).toContainText("BRAND_PRODUCT_NAME");

    // The preview repaints as the operator types, before anything is saved.
    await name.fill("Northwind Voice");
    await expect(page.locator("#stBrand")).toContainText("Northwind Voice");
    await expect(page.locator("[data-brand-name]").first()).toHaveText("VoiceBridge");
    await expect(page.locator(status("branding"))).toContainText("1 change not saved");

    await page.click(save("branding"));
    await expect(page.locator(status("branding"))).toContainText("Saved", { timeout: 20_000 });
    // The effect is visible without a reload: the shell repaints from GET /api/v1/branding.
    await expect(page.locator("[data-brand-name]").first()).toHaveText("Northwind Voice");

    // …and it survived, because the store is the authority.
    await page.reload();
    await expect(page.locator("#set-branding-productName")).toHaveValue("Northwind Voice", {
      timeout: 20_000,
    });
    await expect(page.locator("[data-brand-name]").first()).toHaveText("Northwind Voice");
    await expect(page.locator(field("branding", "productName"))).toContainText("overridden");

    const branding = (await (await request.get(`${BASE}/api/v1/branding`)).json()) as {
      productName: string;
    };
    expect(branding.productName).toBe("Northwind Voice");

    // Another page of the workspace wears it too — branding is deployment-wide, not screen-deep.
    await page.goto(`${BASE}/quality/`);
    await expect(page.locator("[data-brand-name]").first()).toHaveText("Northwind Voice");
  });

  test("a logo is uploaded, shown as the current mark, and removed again", async ({ page, request }) => {
    await unlock(page, "#branding");
    await expect(page.locator("#stLogo")).toContainText("no mark");

    await page.setInputFiles("#stLogoFile", {
      name: "partner.svg",
      mimeType: "image/svg+xml",
      buffer: Buffer.from(
        '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="24"><rect width="120" height="24" fill="#6b2fa0"/></svg>',
      ),
    });

    // The mark is served by this deployment, not by a third party, and the field now holds its URL.
    const logo = page.locator("#stLogo .frame img");
    await expect(logo).toBeVisible({ timeout: 20_000 });
    await expect(page.locator("#set-branding-logoUrl")).toHaveValue(/^\/branding\/logo\.svg\?v=/, {
      timeout: 20_000,
    });
    await expect(page.locator("#stBrand .vb-set-preview .mark img")).toBeVisible();

    const url = (await page.locator("#set-branding-logoUrl").inputValue()).split("?")[0];
    const served = await request.get(`${BASE}${url}`);
    expect(served.status()).toBe(200);
    expect(served.headers()["content-type"]).toContain("image/svg");

    await page.click("#stLogoRemove");
    const confirm = page.locator(".arag-confirm");
    await expect(confirm).toBeVisible();
    await confirm.locator("[data-ok]").click();
    await expect(page.locator("#stLogo")).toContainText("no mark", { timeout: 20_000 });
    await expect(page.locator("#set-branding-logoUrl")).toHaveValue("");
  });

  test("an invalid colour is reported against the colour field, not as a toast", async ({ page }) => {
    await unlock(page, "#branding");
    await page.fill("#set-branding-primaryColor", "javascript:alert(1)");
    await page.click(save("branding"));

    const colour = page.locator(field("branding", "primaryColor"));
    await expect(colour).toHaveAttribute("data-invalid", "1", { timeout: 20_000 });
    await expect(colour.locator(".vb-set-err")).toContainText("colour");
    await expect(page.locator(status("branding"))).toContainText("Not saved");
    // Nothing was thrown at the corner of the screen, and nothing was written.
    await expect(page.locator(".arag-toast")).toHaveCount(0);
    await expect(page.locator(field("branding", "primaryColor"))).not.toContainText("overridden");
  });

  test("a field that overrides the environment offers the environment back", async ({ page }) => {
    await unlock(page, "#branding");
    await page.fill("#set-branding-tagline", "an override");
    await page.click(save("branding"));
    await expect(page.locator(status("branding"))).toContainText("Saved", { timeout: 20_000 });

    const tagline = page.locator(field("branding", "tagline"));
    await expect(tagline).toContainText("overridden");
    // The environment value is named, so "reset" is not a leap of faith.
    await expect(tagline).toContainText(ENV_TAGLINE);

    await tagline.locator("[data-reset]").click();
    await expect(page.locator("#set-branding-tagline")).toHaveValue(ENV_TAGLINE, { timeout: 20_000 });
    await expect(page.locator(field("branding", "tagline"))).toContainText("BRAND_TAGLINE");
    await expect(page.locator(field("branding", "tagline"))).not.toContainText("overridden");
    await page.reload();
    await expect(page.locator("#set-branding-tagline")).toHaveValue(ENV_TAGLINE, { timeout: 20_000 });
  });
});

// ── journey (b): limits ──────────────────────────────────────────────────────

test.describe("limits and timeouts", () => {
  test("edit → reload → persisted → the running configuration reports it", async ({ page, request }) => {
    await unlock(page, "#limits");
    await page.fill("#set-limits-maxHistoryTurns", "11");
    await page.click(save("limits"));
    await expect(page.locator(status("limits"))).toContainText("Saved", { timeout: 20_000 });

    await page.reload();
    await expect(page.locator("#set-limits-maxHistoryTurns")).toHaveValue("11", { timeout: 20_000 });

    // The effect: the live VoiceConfig the whole product shares, with no restart in between.
    const cfg = (await (await request.get(`${BASE}/api/v1/admin/config`, { headers: ADMIN })).json()) as {
      voice: { maxHistoryTurns: number };
    };
    expect(cfg.voice.maxHistoryTurns).toBe(11);
  });

  test("a turn budget at or above the agent tool timeout is refused against its own field", async ({
    page,
    request,
  }) => {
    await unlock(page, "#limits");
    // The agent gives up at 8 s by default; a 60 s turn budget means the caller hears silence.
    await page.fill("#set-limits-turnTimeoutMs", "60000");
    await page.click(save("limits"));

    const budget = page.locator(field("limits", "turnTimeoutMs"));
    await expect(budget).toHaveAttribute("data-invalid", "1", { timeout: 20_000 });
    await expect(budget.locator(".vb-set-err")).toContainText("AGENT_TOOL_TIMEOUT_MS");
    await expect(page.locator(status("limits"))).toContainText("Not saved");

    // Rejected *and* rolled back: the deployment still has a working budget.
    const cfg = (await (await request.get(`${BASE}/api/v1/admin/config`, { headers: ADMIN })).json()) as {
      voice: { turnTimeoutMs: number };
    };
    expect(cfg.voice.turnTimeoutMs).toBe(6000);
  });
});

// ── journey (c): the API key store ───────────────────────────────────────────

test.describe("API keys", () => {
  test("create → the secret is shown once → the list shows it → revoke → marked revoked", async ({
    page,
  }) => {
    await unlock(page, "#api-keys");
    await expect(page.locator("#stKeys")).toContainText("The public API is open");

    await page.fill("#stKeyName", "Playwright integration");
    await page.click("#stKeyCreate");

    const once = page.locator("#stOncePanel");
    await expect(once).toBeVisible({ timeout: 20_000 });
    await expect(once).toContainText("only time it will ever be shown");
    await expect(once.locator(".arag-snippet .copy")).toBeVisible();
    const secret = ((await once.locator(".arag-snippet").textContent()) ?? "").replace("Copy", "").trim();
    expect(secret.startsWith("vbk_")).toBe(true);

    const row = page.locator("#stKeyTable tbody tr", { hasText: "Playwright integration" });
    await expect(row).toContainText("minted here");
    await expect(row).toContainText("active");
    await expect(page.locator("#stKeys")).toContainText("1 active key");

    // Shown exactly once, ever: a reload does not carry it, and nor does the API.
    await page.reload();
    await expect(page.locator("#stKeyTable tbody tr", { hasText: "Playwright integration" })).toBeVisible({
      timeout: 20_000,
    });
    expect(await page.content()).not.toContain(secret);

    // Revoking is behind a typed confirm, and the last key going says so.
    await page
      .locator("#stKeyTable tbody tr", { hasText: "Playwright integration" })
      .locator("[data-revoke]")
      .click();
    const confirm = page.locator(".arag-confirm");
    await expect(confirm).toBeVisible();
    await expect(confirm).toContainText("reopens the public API");
    await expect(confirm.locator("[data-ok]")).toBeDisabled();
    await confirm.locator("#aragTyped").fill("revoke");
    await confirm.locator("[data-ok]").click();

    const revoked = page.locator("#stKeyTable tbody tr", { hasText: "Playwright integration" });
    await expect(revoked).toContainText("revoked", { timeout: 20_000 });
    await expect(revoked.locator("[data-revoke]")).toHaveCount(0);
    await expect(page.locator("#stKeys")).toContainText("The public API is open");
  });
});

// ── secrets ──────────────────────────────────────────────────────────────────

test.describe("secrets", () => {
  const SECRET = "xi-never-render-this-9zk4";

  test("a set secret shows a hint and a rotate control, and is never rendered or blanked", async ({
    page,
    request,
  }) => {
    await request.patch(`${BASE}/api/v1/admin/settings`, {
      headers: ADMIN,
      data: { elevenlabs: { apiKey: SECRET } },
    });

    await unlock(page, "#elevenlabs");
    const key = page.locator(field("elevenlabs", "apiKey"));
    await expect(key).toContainText("set");
    await expect(key).toContainText("9zk4");
    expect(await page.content()).not.toContain(SECRET);

    // An empty submit must not blank a set secret: only a typed value is ever sent.
    await page.fill("#set-elevenlabs-scribeModel", "scribe_v2_realtime_test");
    await page.click(save("elevenlabs"));
    await expect(page.locator(status("elevenlabs"))).toContainText("Saved", { timeout: 20_000 });
    const after = (await (await request.get(`${BASE}/api/v1/admin/settings`, { headers: ADMIN })).json()) as {
      groups: Array<{ id: string; fields: Array<{ key: string; set?: boolean }> }>;
    };
    const stored = after.groups.find((g) => g.id === "elevenlabs")!.fields.find((f) => f.key === "apiKey")!;
    expect(stored.set).toBe(true);
    expect(JSON.stringify(after)).not.toContain(SECRET);

    // Rotate swaps in an empty password field — never the current value.
    await page.locator(field("elevenlabs", "apiKey")).locator("[data-rotate]").click();
    const input = page.locator("#set-elevenlabs-apiKey");
    await expect(input).toHaveAttribute("type", "password");
    await expect(input).toHaveValue("");
  });
});

// ── the voice agent, against a fake ElevenLabs ───────────────────────────────

test.describe("the voice agent", () => {
  let fake: Server | null = null;
  let fakeBase = "";
  let tool: Record<string, unknown> = {};
  let agent: Record<string, unknown> = {};

  test.beforeAll(async () => {
    agent = {
      agent_id: "agent_e2e_1",
      name: "stale name",
      conversation_config: {
        agent: { first_message: "an old greeting", prompt: { prompt: "an old prompt", tool_ids: [] } },
        tts: { voice_id: "v_old" },
      },
    };
    tool = {
      id: "tool_e2e_1",
      tool_config: {
        name: "voice_answer",
        api_schema: {
          url: "https://stale.example/api/v1/voice-answer",
          method: "POST",
          request_headers: {},
        },
      },
    };
    fake = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (c) => chunks.push(c as Buffer));
      req.on("end", () => {
        const raw = Buffer.concat(chunks).toString("utf8");
        const path = (req.url ?? "").split("?")[0] ?? "";
        const patch = req.method === "PATCH" ? (JSON.parse(raw) as Record<string, unknown>) : null;
        if (path.startsWith("/v1/convai/tools/")) {
          if (patch) tool = { ...tool, ...patch };
          res.writeHead(200, { "content-type": "application/json" });
          return res.end(JSON.stringify(tool));
        }
        if (path.startsWith("/v1/convai/agents/")) {
          if (patch) agent = { ...agent, ...patch };
          res.writeHead(200, { "content-type": "application/json" });
          return res.end(JSON.stringify(agent));
        }
        res.writeHead(404, { "content-type": "application/json" });
        res.end(JSON.stringify({ detail: "no route" }));
      });
    });
    await new Promise<void>((resolve) => fake!.listen(0, "127.0.0.1", () => resolve()));
    fakeBase = `http://127.0.0.1:${(fake!.address() as AddressInfo).port}`;
  });

  test.afterAll(async () => {
    await new Promise<void>((resolve) => (fake ? fake.close(() => resolve()) : resolve()));
    fake = null;
  });

  test("says ElevenLabs is not configured, and points at the field rather than showing a dead panel", async ({
    page,
  }) => {
    await unlock(page, "#elevenlabs");
    await expect(page.locator("#stAgent")).toContainText("ElevenLabs is not configured", {
      timeout: 20_000,
    });
    await expect(page.locator("#stAgent")).toContainText("API key");
    await expect(page.locator("#stPush")).toBeDisabled();
    await expect(page.locator("#stCapabilities")).toContainText("not configured");
  });

  test("shows the diff against the live agent and pushes it into sync", async ({ page, request }) => {
    // Turn the voice on from the product, pointed at the fake. The real API is never called.
    await request.patch(`${BASE}/api/v1/admin/settings`, {
      headers: ADMIN,
      data: { elevenlabs: { apiKey: "xi-fake-key", apiBase: fakeBase } },
    });
    const created = (await (
      await request.post(`${BASE}/api/v1/admin/api-keys`, { headers: ADMIN, data: { name: "Voice agent" } })
    ).json()) as { key: { id: string }; secret: string };
    const record = (await (
      await request.get(`${BASE}/api/v1/admin/prospects/progress`, { headers: ADMIN })
    ).json()) as Record<string, unknown>;
    const { id: _id, createdAt: _c, updatedAt: _u, ...config } = record;
    await request.put(`${BASE}/api/v1/admin/prospects/progress`, {
      headers: ADMIN,
      data: { ...config, agent_id: "agent_e2e_1", tool_id: "tool_e2e_1" },
    });

    await unlock(page, "#voice-agent");
    const panel = page.locator("#stAgent");
    await expect(panel).toContainText("fields differ", { timeout: 20_000 });
    // Which key the tool's X-API-Key header will carry — the id and prefix, never the secret.
    await expect(panel).toContainText("Voice agent");
    expect(await page.content()).not.toContain(created.secret);
    const diff = page.locator(".vb-set-diff tbody tr");
    await expect(diff.filter({ hasText: "Greeting" })).toContainText("an old greeting");
    await expect(diff.filter({ hasText: "Tool URL" })).toContainText("stale.example");

    await page.click("#stPush");
    await expect(panel).toContainText("in sync with ElevenLabs", { timeout: 30_000 });
    await expect(page.locator("#stPushStatus")).toContainText("Applied");
    await expect(page.locator(".vb-set-diff tr[data-matches='false']")).toHaveCount(0);

    // The fake really was written: this deployment's URL, and the key in the header.
    const api = (tool.tool_config as { api_schema: Record<string, unknown> }).api_schema;
    expect(String(api.url).endsWith("/api/v1/voice-answer")).toBe(true);
    expect((api.request_headers as Record<string, string>)["X-API-Key"]).toBe(created.secret);

    // Clean up the key this journey minted, so the deployment goes back to open.
    await request.delete(`${BASE}/api/v1/admin/api-keys/${created.key.id}`, { headers: ADMIN });
  });
});

// ── retention and purge ──────────────────────────────────────────────────────

test.describe("retention", () => {
  test("a purge that ignores the windows is behind a typed confirm that names what will go", async ({
    page,
    request,
  }) => {
    await request.post(`${BASE}/api/v1/voice-answer`, {
      headers: ADMIN,
      data: { prospect: "progress", question: "What is binder jetting?" },
    });

    await unlock(page, "#retention");
    await page.selectOption("#stPurgeScope", "turns");
    await page.click("#stPurgeRun");

    const confirm = page.locator(".arag-confirm");
    await expect(confirm).toBeVisible();
    await expect(confirm).toContainText("every recorded turn, at any age");
    await expect(confirm.locator("[data-ok]")).toBeDisabled();
    await confirm.locator("#aragTyped").fill("turns");
    await confirm.locator("[data-ok]").click();

    await expect(page.locator("#stPurgeResult")).toContainText("Purged", { timeout: 20_000 });
  });

  test("the retention windows are editable and take effect immediately", async ({ page, request }) => {
    await unlock(page, "#retention");
    await page.fill("#set-retention-turnDays", "30");
    await page.click(save("retention"));
    await expect(page.locator(status("retention"))).toContainText("Saved", { timeout: 20_000 });

    await page.reload();
    await expect(page.locator("#set-retention-turnDays")).toHaveValue("30", { timeout: 20_000 });
    const cfg = (await (await request.get(`${BASE}/api/v1/admin/config`, { headers: ADMIN })).json()) as {
      voice: { retention: { turnDays: number } };
    };
    expect(cfg.voice.retention.turnDays).toBe(30);
  });
});

// ── connection and the shape of the page on a phone ──────────────────────────

test.describe("connection", () => {
  test("the Knowledge Box this deployment answers from is editable here", async ({ page, request }) => {
    await unlock(page, "#connection");
    await expect(page.locator("#stConnection")).toContainText("Connection health", { timeout: 20_000 });
    await page.fill("#set-connection-kbId", "kb-from-the-product");
    await page.click(save("connection"));
    await expect(page.locator(status("connection"))).toContainText("Saved", { timeout: 20_000 });

    await page.reload();
    await expect(page.locator("#set-connection-kbId")).toHaveValue("kb-from-the-product", {
      timeout: 20_000,
    });
    const cfg = (await (await request.get(`${BASE}/api/v1/admin/config`, { headers: ADMIN })).json()) as {
      env: { arag: { kbId: string } };
    };
    expect(cfg.env.arag.kbId).toBe("kb-from-the-product");
  });

  test("renders on a phone with no sideways scroll and no console errors", async ({ page }) => {
    // The shell probes /api/v1/admin/usage to find out whether this browser is an operator; a 401
    // before the token is entered is the answer, not a fault.
    const problems: string[] = [];
    page.on("console", (m) => {
      if (m.type() === "error" && !m.text().includes("401")) problems.push(m.text());
    });
    page.on("pageerror", (e) => problems.push(String(e)));
    await page.setViewportSize({ width: 390, height: 844 });
    await unlock(page, "#branding");
    await expect(page.locator("#stBrand")).toBeVisible();
    const sideways = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    expect(sideways).toBe(false);
    expect(problems).toEqual([]);
  });
});

test.describe("the section index", () => {
  test("marks the section the reader is actually in", async ({ page }) => {
    await unlock(page);
    await expect(page.locator(".vb-set-section").first()).toBeVisible({ timeout: 20_000 });
    for (const id of ["connection", "branding", "limits", "elevenlabs", "api-keys", "retention"]) {
      // Put the section's heading just under the sticky index, the way a reader scrolling would.
      await page.evaluate((sel) => {
        const el = document.querySelector(sel);
        if (el) {
          window.scrollTo({
            top: window.scrollY + el.getBoundingClientRect().top - 100,
            behavior: "instant",
          });
        }
      }, `#${id}`);
      await page.waitForTimeout(200);
      // A section taller than the viewport stops producing observer entries while you are still
      // inside it; the index is decided from geometry so it cannot drift a section behind.
      await expect(page.locator("[data-jump][aria-current]")).toHaveAttribute("data-jump", id);
    }
  });
});
