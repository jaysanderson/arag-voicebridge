/**
 * Environment configuration. Secrets live ONLY here (process env / Fly.io secrets),
 * never client-side, never in the repo (SPEC §10, §12).
 *
 * Loads bridge/.env in development via a tiny zero-dependency parser so we don't pull
 * in dotenv. In production (Fly.io) the env is injected and no .env file exists.
 */

import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Minimal .env loader: KEY=VALUE lines, `#` comments, no interpolation. */
function loadDotEnv(): void {
  const envPath = resolve(__dirname, "..", ".env");
  if (!existsSync(envPath)) return;
  const raw = readFileSync(envPath, "utf8");
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    // Strip surrounding quotes if present.
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    // Real env wins over .env file.
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

loadDotEnv();

function num(name: string, fallback: number): number {
  const v = process.env[name];
  if (v === undefined || v === "") return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function str(name: string, fallback = ""): string {
  const v = process.env[name];
  return v === undefined || v === "" ? fallback : v;
}

export interface AppConfig {
  port: number;
  nodeEnv: string;
  logLevel: string;
  aragToken: string;
  aragRegionDefault: string;
  aragTimeoutMs: number;
  agentToolTimeoutMs: number;
  maxHistoryTurns: number;
  allowedOrigins: string[];
  // --- LiveAvatar (HeyGen) + LiveKit (optional; the avatar pane is dormant until set) ---
  liveAvatarApiKey: string;
  liveAvatarApiBase: string;
  liveAvatarSecretsPath: string;
  liveAvatarSessionPath: string;
  liveAvatarElevenLabsSecretId: string;
  elevenLabsApiKey: string;
  livekitUrl: string;
  livekitApiKey: string;
  livekitApiSecret: string;
}

export const config: AppConfig = {
  port: num("PORT", 8080),
  nodeEnv: str("NODE_ENV", "development"),
  logLevel: str("LOG_LEVEL", "info"),
  aragToken: str("ARAG_TOKEN"),
  aragRegionDefault: str("ARAG_REGION_DEFAULT", "europe-1"),
  aragTimeoutMs: num("ARAG_TIMEOUT_MS", 6000),
  agentToolTimeoutMs: num("AGENT_TOOL_TIMEOUT_MS", 8000),
  maxHistoryTurns: num("MAX_HISTORY_TURNS", 6),
  allowedOrigins: str("ALLOWED_ORIGINS", "http://localhost:5173")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
  liveAvatarApiKey: str("LIVEAVATAR_API_KEY"),
  liveAvatarApiBase: str("LIVEAVATAR_API_BASE", "https://api.liveavatar.com/v1"),
  liveAvatarSecretsPath: str("LIVEAVATAR_SECRETS_PATH", "/secrets"),
  liveAvatarSessionPath: str("LIVEAVATAR_SESSION_PATH", "/sessions"),
  liveAvatarElevenLabsSecretId: str("LIVEAVATAR_ELEVENLABS_SECRET_ID"),
  elevenLabsApiKey: str("ELEVENLABS_API_KEY"),
  livekitUrl: str("LIVEKIT_URL"),
  livekitApiKey: str("LIVEKIT_API_KEY"),
  livekitApiSecret: str("LIVEKIT_API_SECRET"),
};

/**
 * Is the LiveAvatar pane configured? It stays dormant (endpoint 503s, UI hides the toggle)
 * until the LiveKit creds, a LiveAvatar key, and an ElevenLabs key/secret are all present.
 */
export function avatarEnabled(): boolean {
  return Boolean(
    config.liveAvatarApiKey &&
      config.livekitUrl &&
      config.livekitApiKey &&
      config.livekitApiSecret &&
      (config.liveAvatarElevenLabsSecretId || config.elevenLabsApiKey),
  );
}

/**
 * Fail fast on misconfiguration that would make every turn dead air, but only in
 * production — local dev/tests can run without a token (the ARAG client will surface
 * a clear error per turn instead).
 */
export function assertConfig(): void {
  if (config.nodeEnv === "production" && !config.aragToken) {
    throw new Error(
      "ARAG_TOKEN is required in production. Set it as a Fly.io secret — never in the repo.",
    );
  }
  if (config.aragTimeoutMs >= config.agentToolTimeoutMs) {
    // SPEC §6.2.3: bridge must resolve within the agent tool timeout or the agent stalls.
    throw new Error(
      `ARAG_TIMEOUT_MS (${config.aragTimeoutMs}) must be < AGENT_TOOL_TIMEOUT_MS ` +
        `(${config.agentToolTimeoutMs}) so the bridge resolves before the agent gives up.`,
    );
  }
}
