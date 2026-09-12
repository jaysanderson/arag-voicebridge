/**
 * VoiceBridge configuration = the platform env (`readEnv`) + the product's `VOICE_*` /
 * integration variables. Secrets live only in the environment (.env locally, Fly secrets in
 * production); they are never sent to browsers and never logged.
 */
import type { PlatformEnv } from "../vendor/arag-platform/src/index.ts";

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

export interface VoiceConfig {
  /** Region used when a prospect omits `region`. */
  aragRegionDefault: string;
  /** Per-turn ARAG timeout — must stay below the agent tool timeout to avoid dead air. */
  turnTimeoutMs: number;
  /** Timeout the ElevenLabs agent applies to its custom server tool. */
  agentToolTimeoutMs: number;
  /** Longer budget for the Listen-mode brief (not blocking speech). */
  briefTimeoutMs: number;
  /** Prior conversation turns forwarded to ARAG as `context` (1 turn = USER + NUCLIA). */
  maxHistoryTurns: number;
  /** Agent id seeded into the default prospect when the example registry has a placeholder. */
  defaultAgentId: string;
  /** Display name override for the seeded default prospect (cosmetic). */
  kbTitle: string;
  /** Turn-log ring size (admin turn inspection). */
  turnLogLimit: number;
  /** Stricter per-IP limits for the expensive endpoints. */
  briefRps: number;
  briefBurst: number;
  scribeRps: number;
  scribeBurst: number;
  elevenLabsApiKey: string;
  elevenLabsApiBase: string;
  liveAvatarApiKey: string;
  liveAvatarApiBase: string;
  liveAvatarSecretsPath: string;
  liveAvatarSessionPath: string;
  liveAvatarElevenLabsSecretId: string;
  livekitUrl: string;
  livekitApiKey: string;
  livekitApiSecret: string;
}

/** Read the product configuration from the environment (defaults are demo-safe). */
export function readVoiceEnv(src: Src = process.env): VoiceConfig {
  return {
    aragRegionDefault: str(src, "ARAG_REGION_DEFAULT", "aws-us-east-2-1"),
    turnTimeoutMs: num(src, "VOICE_TURN_TIMEOUT_MS", 6000),
    agentToolTimeoutMs: num(src, "AGENT_TOOL_TIMEOUT_MS", 8000),
    briefTimeoutMs: num(src, "VOICE_BRIEF_TIMEOUT_MS", 12000),
    maxHistoryTurns: num(src, "MAX_HISTORY_TURNS", 6),
    defaultAgentId: str(src, "VOICE_DEFAULT_AGENT_ID"),
    kbTitle: str(src, "VOICE_KB_TITLE"),
    turnLogLimit: num(src, "VOICE_TURN_LOG_LIMIT", 500),
    briefRps: num(src, "VOICE_BRIEF_RATE_RPS", 1),
    briefBurst: num(src, "VOICE_BRIEF_RATE_BURST", 5),
    scribeRps: num(src, "VOICE_SCRIBE_RATE_RPS", 0.2),
    scribeBurst: num(src, "VOICE_SCRIBE_RATE_BURST", 3),
    elevenLabsApiKey: str(src, "ELEVENLABS_API_KEY"),
    elevenLabsApiBase: str(src, "ELEVENLABS_API_BASE", "https://api.elevenlabs.io"),
    liveAvatarApiKey: str(src, "LIVEAVATAR_API_KEY"),
    liveAvatarApiBase: str(src, "LIVEAVATAR_API_BASE", "https://api.liveavatar.com/v1"),
    liveAvatarSecretsPath: str(src, "LIVEAVATAR_SECRETS_PATH", "/secrets"),
    liveAvatarSessionPath: str(src, "LIVEAVATAR_SESSION_PATH", "/sessions"),
    liveAvatarElevenLabsSecretId: str(src, "LIVEAVATAR_ELEVENLABS_SECRET_ID"),
    livekitUrl: str(src, "LIVEKIT_URL"),
    livekitApiKey: str(src, "LIVEKIT_API_KEY"),
    livekitApiSecret: str(src, "LIVEKIT_API_SECRET"),
  };
}

/** Is the ambient "Listen" mode available? Needs only an ElevenLabs key (Scribe STT). */
export function scribeEnabled(v: VoiceConfig): boolean {
  return Boolean(v.elevenLabsApiKey);
}

/** Is the LiveAvatar pane configured? Needs LiveAvatar + LiveKit + an ElevenLabs key/secret. */
export function avatarEnabled(v: VoiceConfig): boolean {
  return Boolean(
    v.liveAvatarApiKey &&
      v.livekitUrl &&
      v.livekitApiKey &&
      v.livekitApiSecret &&
      (v.liveAvatarElevenLabsSecretId || v.elevenLabsApiKey),
  );
}

/**
 * Fail fast on configuration that would make every turn dead air. The turn timeout must
 * resolve before the agent's tool call gives up, or the agent stalls mid-conversation.
 */
export function assertVoiceConfig(env: PlatformEnv, v: VoiceConfig): void {
  if (v.turnTimeoutMs >= v.agentToolTimeoutMs) {
    throw new Error(
      `VOICE_TURN_TIMEOUT_MS (${v.turnTimeoutMs}) must be < AGENT_TOOL_TIMEOUT_MS (${v.agentToolTimeoutMs}) ` +
        "so the bridge always resolves a turn before the agent's tool call times out.",
    );
  }
  if (env.nodeEnv === "production" && !env.adminToken) {
    throw new Error("ADMIN_TOKEN is required in production (it protects /admin and /api/v1/admin/*).");
  }
}

/** Non-secret view of the product config for the admin config page. */
export function describeVoiceConfig(v: VoiceConfig): Record<string, unknown> {
  return {
    aragRegionDefault: v.aragRegionDefault,
    turnTimeoutMs: v.turnTimeoutMs,
    agentToolTimeoutMs: v.agentToolTimeoutMs,
    briefTimeoutMs: v.briefTimeoutMs,
    maxHistoryTurns: v.maxHistoryTurns,
    turnLogLimit: v.turnLogLimit,
    rateLimits: {
      brief: { rps: v.briefRps, burst: v.briefBurst },
      scribeToken: { rps: v.scribeRps, burst: v.scribeBurst },
    },
    elevenLabs: { configured: Boolean(v.elevenLabsApiKey), apiBase: v.elevenLabsApiBase },
    liveAvatar: { configured: Boolean(v.liveAvatarApiKey), apiBase: v.liveAvatarApiBase },
    livekit: {
      configured: Boolean(v.livekitUrl && v.livekitApiKey && v.livekitApiSecret),
      url: v.livekitUrl,
    },
    // Non-secret: the same value is served to browsers on /api/v1/prospects.
    defaultAgentId: v.defaultAgentId,
    features: { scribe: scribeEnabled(v), avatar: avatarEnabled(v) },
  };
}
