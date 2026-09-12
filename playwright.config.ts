import { defineConfig } from "@playwright/test";

const port = Number(process.env.PW_PORT ?? 8181);
export default defineConfig({
  testDir: process.env.SHOWCASE ? "showcase" : "test/e2e",
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
  webServer: {
    command: `ARAG_MOCK=1 ADMIN_TOKEN=e2e-admin-token DATA_DIR=./data/e2e LOG_LEVEL=warn RATE_LIMIT_RPS=100 RATE_LIMIT_BURST=200 PORT=${port} node src/index.ts`,
    url: `http://127.0.0.1:${port}/healthz`,
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
});
