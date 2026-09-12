/**
 * Environment configuration for ARAG products.
 *
 * - Loads a `.env` file (nearest of: $ENV_FILE, ./.env, ../.env) without overriding real env.
 * - Exposes a typed, validated view of the variables every product shares.
 * - Never logs secret values; `describeEnv()` redacts them for admin panels.
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface AragEnv {
  /** Knowledge Box id (uuid). */
  kbId: string;
  /** Service-account token, sent as `X-NUCLIA-SERVICEACCOUNT: Bearer …`. */
  apiKey: string;
  /** Zone/region slug, e.g. `aws-us-east-2-1`, `europe-1`. */
  region: string;
  /** Optional full base URL override, e.g. https://aws-us-east-2-1.dp.progress.cloud/api/v1 */
  baseUrl: string;
  /** Default generative model name (empty = KB default). */
  generativeModel: string;
  /** Default reranker: predict | noop. */
  reranker: string;
  /** Per-request timeout to ARAG in ms. */
  timeoutMs: number;
  /** When true, products talk to the in-process mock ARAG server. */
  mock: boolean;
}

export interface PlatformEnv {
  nodeEnv: string;
  port: number;
  host: string;
  logLevel: LogLevel;
  /** Directory for JSON stores (jobs, records, configs). */
  dataDir: string;
  /** Bearer/cookie token that protects /admin and /api/v1/admin. Empty = admin disabled (403). */
  adminToken: string;
  /** Comma-separated API keys. Empty = public API open. */
  apiKeys: string[];
  /** Comma-separated allowed CORS origins ("*" allowed). */
  allowedOrigins: string[];
  rateLimitRps: number;
  rateLimitBurst: number;
  maxBodyBytes: number;
  /** Public base URL used in docs/links (optional). */
  publicUrl: string;
  /** Which proxy header identifies the client IP: fly (default) | xff | none. */
  trustProxy: "fly" | "xff" | "none";
  arag: AragEnv;
}

/** Minimal .env parser: KEY=VALUE, `#` comments, optional quotes, no interpolation. */
export function parseDotEnv(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed
      .slice(0, eq)
      .trim()
      .replace(/^export\s+/, "");
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (key) out[key] = value;
  }
  return out;
}

/** Load the first .env file found into process.env (real env always wins). Returns the path used. */
export function loadDotEnv(candidates?: string[]): string | null {
  const list = candidates ?? [
    process.env.ENV_FILE ?? "",
    resolve(process.cwd(), ".env"),
    resolve(process.cwd(), "..", ".env"),
  ];
  for (const p of list) {
    if (!p || !existsSync(p)) continue;
    const parsed = parseDotEnv(readFileSync(p, "utf8"));
    for (const [k, v] of Object.entries(parsed)) {
      if (process.env[k] === undefined) process.env[k] = v;
    }
    return p;
  }
  return null;
}

type Src = Record<string, string | undefined>;

function str(src: Src, name: string, fallback = ""): string {
  const v = src[name];
  return v === undefined || v === "" ? fallback : v;
}
function num(src: Src, name: string, fallback: number): number {
  const v = src[name];
  if (v === undefined || v === "") return fallback;
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error(`Env ${name} must be a number, got "${v}"`);
  return n;
}
function bool(src: Src, name: string, fallback = false): boolean {
  const v = src[name];
  if (v === undefined || v === "") return fallback;
  return ["1", "true", "yes", "on"].includes(v.toLowerCase());
}
function list(src: Src, name: string, fallback: string[] = []): string[] {
  const v = src[name];
  if (v === undefined || v === "") return fallback;
  return v
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

const LEVELS: LogLevel[] = ["debug", "info", "warn", "error"];

/**
 * Read the platform env from `src` (defaults to process.env). Does not throw on missing
 * ARAG credentials — call `assertAragEnv()` at startup for products that require them.
 */
export function readEnv(src: Src = process.env): PlatformEnv {
  const level = str(src, "LOG_LEVEL", "info") as LogLevel;
  if (!LEVELS.includes(level)) throw new Error(`LOG_LEVEL must be one of ${LEVELS.join("|")}`);
  const mock = bool(src, "ARAG_MOCK", false);
  return {
    nodeEnv: str(src, "NODE_ENV", "development"),
    port: num(src, "PORT", 8080),
    host: str(src, "HOST", "0.0.0.0"),
    logLevel: level,
    dataDir: str(src, "DATA_DIR", resolve(process.cwd(), "data")),
    adminToken: str(src, "ADMIN_TOKEN"),
    apiKeys: list(src, "API_KEYS"),
    allowedOrigins: list(src, "ALLOWED_ORIGINS"),
    rateLimitRps: num(src, "RATE_LIMIT_RPS", 5),
    rateLimitBurst: num(src, "RATE_LIMIT_BURST", 20),
    maxBodyBytes: num(src, "MAX_BODY_BYTES", 26_214_400),
    publicUrl: str(src, "PUBLIC_URL"),
    trustProxy: (() => {
      const v = str(src, "TRUST_PROXY", "fly");
      if (!["fly", "xff", "none"].includes(v)) throw new Error("TRUST_PROXY must be fly | xff | none");
      return v as "fly" | "xff" | "none";
    })(),
    arag: {
      kbId: str(src, "ARAG_KB_ID"),
      apiKey: str(src, "ARAG_API_KEY"),
      region: str(src, "ARAG_REGION", "aws-us-east-2-1"),
      baseUrl: str(src, "ARAG_BASE_URL"),
      generativeModel: str(src, "ARAG_GENERATIVE_MODEL"),
      reranker: str(src, "ARAG_RERANKER", "predict"),
      timeoutMs: num(src, "ARAG_TIMEOUT_MS", 60_000),
      mock,
    },
  };
}

/** Throw a clear error if live ARAG credentials are required but missing. */
export function assertAragEnv(env: PlatformEnv): void {
  if (env.arag.mock) return;
  const missing: string[] = [];
  if (!env.arag.kbId) missing.push("ARAG_KB_ID");
  if (!env.arag.apiKey) missing.push("ARAG_API_KEY");
  if (!env.arag.region && !env.arag.baseUrl) missing.push("ARAG_REGION");
  if (missing.length) {
    throw new Error(
      `Missing required ARAG configuration: ${missing.join(", ")}. Copy .env.example to .env and fill them in, or set ARAG_MOCK=1 to run against the mock ARAG server.`,
    );
  }
}

const SECRET_RE = /(token|key|secret|password)/i;

/** A redacted, admin-safe view of the env for config pages. */
export function describeEnv(env: PlatformEnv): Record<string, unknown> {
  const redact = (k: string, v: unknown): unknown => {
    if (typeof v === "string" && SECRET_RE.test(k)) return v ? `•••(${v.length} chars)` : "";
    if (Array.isArray(v) && SECRET_RE.test(k)) return v.map(() => "•••");
    return v;
  };
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(env)) {
    if (k === "arag") {
      const a: Record<string, unknown> = {};
      for (const [ak, av] of Object.entries(v as AragEnv)) a[ak] = redact(ak, av);
      out.arag = a;
    } else out[k] = redact(k, v);
  }
  return out;
}
