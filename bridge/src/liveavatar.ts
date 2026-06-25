/**
 * LiveAvatar (HeyGen) API client — LITE mode with a bring-your-own LiveKit room.
 *
 * ⚠️ LIVE-VERIFY (like arag.ts §18): LiveAvatar's full request/response shapes are behind a
 * paid/gated API. The endpoint paths and field names below are correct in STRUCTURE per the
 * public docs, but MUST be confirmed against the live API once a LiveAvatar key exists — they
 * are all isolated here and the paths are env-overridable so no other file changes when they
 * drift. See docs/LIVEAVATAR_SETUP.md.
 *
 * Flow (LITE mode):
 *   1. registerElevenLabsKey(elevenLabsKey) -> secret_id     (once; or pass a pre-registered id)
 *   2. startLiteSession({ avatarId, secretId, agentId, livekit{url,room,token} }) -> session
 *      LiveAvatar dispatches a worker that joins our LiveKit room and bridges the ElevenLabs
 *      agent <-> room; the avatar video is published into the room for the browser to render.
 *
 * Docs: https://docs.liveavatar.com/docs/lite-mode/connectors/elevenlabs-agent
 *       https://docs.liveavatar.com/docs/custom-mode-life-cycle
 */

import { config } from "./config.ts";
import { log } from "./logger.ts";

export class LiveAvatarError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = "LiveAvatarError";
  }
}

function authHeaders(): Record<string, string> {
  return {
    "X-API-KEY": config.liveAvatarApiKey,
    "Content-Type": "application/json",
    Accept: "application/json",
  };
}

async function postJson(path: string, body: unknown): Promise<any> {
  const url = `${config.liveAvatarApiBase.replace(/\/$/, "")}${path}`;
  let res: Response;
  try {
    res = await fetch(url, { method: "POST", headers: authHeaders(), body: JSON.stringify(body) });
  } catch (err) {
    throw new LiveAvatarError(`LiveAvatar network error: ${(err as Error).message}`);
  }
  const text = await res.text();
  if (!res.ok) {
    throw new LiveAvatarError(`LiveAvatar ${path} -> HTTP ${res.status}: ${text.slice(0, 300)}`, res.status);
  }
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    throw new LiveAvatarError(`LiveAvatar ${path} returned non-JSON: ${text.slice(0, 200)}`);
  }
}

/**
 * Register an ElevenLabs API key with LiveAvatar and return the secret_id.
 * Prefer setting LIVEAVATAR_ELEVENLABS_SECRET_ID once and skipping this at request time.
 */
export async function registerElevenLabsKey(elevenLabsApiKey: string): Promise<string> {
  const out = await postJson(config.liveAvatarSecretsPath, {
    secret_type: "ELEVENLABS_API_KEY",
    secret_value: elevenLabsApiKey,
    secret_name: "arag-voice ElevenLabs Agent Key",
  });
  const id = out.secret_id ?? out.id ?? out.data?.secret_id;
  if (!id) throw new LiveAvatarError(`No secret_id in LiveAvatar response: ${JSON.stringify(out).slice(0, 200)}`);
  return id as string;
}

let cachedSecretId: string | null = null;

/**
 * Resolve the ElevenLabs secret_id: prefer a pre-registered LIVEAVATAR_ELEVENLABS_SECRET_ID;
 * otherwise register ELEVENLABS_API_KEY once and cache the result for the process lifetime.
 */
export async function resolveSecretId(): Promise<string> {
  if (config.liveAvatarElevenLabsSecretId) return config.liveAvatarElevenLabsSecretId;
  if (cachedSecretId) return cachedSecretId;
  if (!config.elevenLabsApiKey) {
    throw new LiveAvatarError(
      "Set LIVEAVATAR_ELEVENLABS_SECRET_ID, or ELEVENLABS_API_KEY so the bridge can register one.",
    );
  }
  cachedSecretId = await registerElevenLabsKey(config.elevenLabsApiKey);
  log.info("liveavatar.secret.registered", {});
  return cachedSecretId;
}

export interface StartSessionParams {
  avatarId: string;
  secretId: string;
  agentId: string;
  livekitUrl: string;
  livekitRoom: string;
  /** Token LiveAvatar's worker uses to join our LiveKit room. */
  livekitWorkerToken: string;
}

export interface LiveAvatarSession {
  sessionId?: string;
  raw: any;
}

/**
 * Start a LITE-mode session that streams the avatar into our LiveKit room and wires the
 * ElevenLabs agent in. Returns whatever LiveAvatar reports (session id, status).
 */
export async function startLiteSession(p: StartSessionParams): Promise<LiveAvatarSession> {
  const body = {
    mode: "LITE",
    avatar_id: p.avatarId,
    elevenlabs_agent_config: {
      secret_id: p.secretId,
      agent_id: p.agentId,
    },
    // Bring-your-own LiveKit room (LITE mode).
    custom_livekit_config: {
      livekit_url: p.livekitUrl,
      livekit_room: p.livekitRoom,
      livekit_client_token: p.livekitWorkerToken,
    },
  };
  const out = await postJson(config.liveAvatarSessionPath, body);
  log.info("liveavatar.session.start", { room: p.livekitRoom, avatar: p.avatarId });
  return { sessionId: out.session_id ?? out.id ?? out.data?.session_id, raw: out };
}
