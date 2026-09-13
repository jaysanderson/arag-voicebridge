import { defineConfig } from "@playwright/test";

// A product-specific default so a sibling product's dev server on a shared machine cannot be
// reused as this suite's web server (reuseExistingServer is on outside CI). Override with PW_PORT.
const port = Number(process.env.PW_PORT ?? 8281);
// A second instance with partner branding, so the white-label path is tested as a real deployment
// rather than by poking at the DOM.
const brandedPort = port + 1;
export const BRANDED_URL = `http://127.0.0.1:${brandedPort}`;
// Override with PW_DATA_DIR so two runs on the same machine (a live dev server plus this suite, or
// two checkouts of this suite) never share — and race on flushing — the same session store files.
const dataDir = process.env.PW_DATA_DIR ?? "./data/e2e";
const brandedDataDir = process.env.PW_DATA_DIR ? `${dataDir}-branded` : "./data/e2e-branded";
export default defineConfig({
  testDir: process.env.PW_TESTDIR ?? (process.env.SHOWCASE ? "showcase" : "test/e2e"),
  timeout: 60_000,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    channel: process.env.PW_CHANNEL ?? (process.env.CI ? undefined : "chrome"),
    video: process.env.SHOWCASE ? { mode: "on", size: { width: 1280, height: 800 } } : "retain-on-failure",
    viewport: { width: 1280, height: 800 },
    permissions: ["microphone"],
  },
  outputDir: process.env.SHOWCASE ? "showcase/out" : "test-results",
  webServer: [
    {
      // ENV_FILE=/dev/null keeps a developer's real .env out of the run: the suite must behave the
      // same on a laptop with live credentials as it does on a clean clone or in CI.
      command:
        // LOG_LEVEL=info, not warn: the operator log is a product surface now — settings changes
        // and agent pushes are audited into it, and the Logs view pages over it — so the suite has
        // to be able to read what the product wrote.
        `ENV_FILE=/dev/null ARAG_MOCK=1 ADMIN_TOKEN=e2e-admin-token DATA_DIR=${dataDir} ` +
        `LOG_LEVEL=info RATE_LIMIT_RPS=100 RATE_LIMIT_BURST=200 PORT=${port} node src/index.ts`,
      url: `http://127.0.0.1:${port}/healthz`,
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
    },
    {
      command:
        `ENV_FILE=/dev/null ARAG_MOCK=1 ADMIN_TOKEN=e2e-admin-token DATA_DIR=${brandedDataDir} ` +
        `LOG_LEVEL=warn RATE_LIMIT_RPS=100 RATE_LIMIT_BURST=200 PORT=${brandedPort} ` +
        `BRAND_PRODUCT_NAME="Contoso Live Assist" BRAND_TAGLINE="grounded call context" ` +
        `BRAND_POWERED_BY=0 BRAND_PRIMARY_COLOR="#6b2fa0" BRAND_FOOTER_TEXT="© Contoso" ` +
        `node src/index.ts`,
      url: `${BRANDED_URL}/healthz`,
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
    },
  ],
});
