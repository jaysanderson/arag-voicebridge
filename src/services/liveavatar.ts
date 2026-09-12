/**
 * LiveAvatar (HeyGen) API client — LITE mode with a bring-your-own LiveKit room.
 *
 * ⚠️ LIVE-VERIFY: LiveAvatar's request/response shapes are behind a paid/gated API. The
 * endpoint paths and field names below are correct in STRUCTURE per the public docs but must be
 * confirmed against the live API once a LiveAvatar key exists — they are all isolated here and
 * the paths are env-overridable, so no other file changes when they drift.
 *
 * Flow (LITE mode):
 *   1. registerElevenLabsKey(key) -> secret_id (once; or pass a pre-registered id)
 *   2. startLiteSession({...}) -> LiveAvatar dispatches a worker that joins our LiveKit room,
 *      bridges the ElevenLabs agent, and publishes the avatar video for the browser to render.
 */
import type { Logger } from "../../vendor/arag-platform/src/index.ts";
import type { VoiceConfig } from "../config.ts";
import type { FetchLike } from "./scribe.ts";

export class LiveAvatarError extends Error {
  readonly status: number | undefined;
  constructor(message: string, status?: number) {
    super(message);
    this.name = "LiveAvatarError";
    this.status = status;
  }
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
  raw: Record<string, unknown>;
}

/** Thin, injectable client so tests never touch the network. */
export class LiveAvatarClient {
  private readonly cfg: VoiceConfig;
  private readonly fetchImpl: FetchLike;
  private readonly log: Logger | undefined;
  private cachedSecretId: string | null = null;

  constructor(cfg: VoiceConfig, opts: { fetch?: FetchLike; log?: Logger } = {}) {
    this.cfg = cfg;
    this.fetchImpl = opts.fetch ?? fetch;
    this.log = opts.log;
  }

  private headers(): Record<string, string> {
    return {
      "X-API-KEY": this.cfg.liveAvatarApiKey,
      "Content-Type": "application/json",
      Accept: "application/json",
    };
  }

  private async postJson(path: string, body: unknown): Promise<Record<string, unknown>> {
    const url = `${this.cfg.liveAvatarApiBase.replace(/\/$/, "")}${path}`;
    let res: Response;
    try {
      res = await this.fetchImpl(url, {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify(body),
      });
    } catch (err) {
      throw new LiveAvatarError(`LiveAvatar network error: ${(err as Error).message}`, 502);
    }
    const text = await res.text();
    if (!res.ok) throw new LiveAvatarError(`LiveAvatar ${path} -> HTTP ${res.status}`, res.status);
    try {
      return text ? (JSON.parse(text) as Record<string, unknown>) : {};
    } catch {
      throw new LiveAvatarError(`LiveAvatar ${path} returned non-JSON`, 502);
    }
  }

  /** Register an ElevenLabs API key with LiveAvatar and return the secret_id. */
  async registerElevenLabsKey(elevenLabsApiKey: string): Promise<string> {
    const out = await this.postJson(this.cfg.liveAvatarSecretsPath, {
      secret_type: "ELEVENLABS_API_KEY",
      secret_value: elevenLabsApiKey,
      secret_name: "VoiceBridge ElevenLabs Agent Key",
    });
    const nested = out.data as Record<string, unknown> | undefined;
    const id = (out.secret_id ?? out.id ?? nested?.secret_id) as string | undefined;
    if (!id) throw new LiveAvatarError("LiveAvatar returned no secret_id", 502);
    return id;
  }

  /**
   * Resolve the ElevenLabs secret_id: prefer a pre-registered
   * LIVEAVATAR_ELEVENLABS_SECRET_ID; otherwise register ELEVENLABS_API_KEY once and cache it.
   */
  async resolveSecretId(): Promise<string> {
    if (this.cfg.liveAvatarElevenLabsSecretId) return this.cfg.liveAvatarElevenLabsSecretId;
    if (this.cachedSecretId) return this.cachedSecretId;
    if (!this.cfg.elevenLabsApiKey) {
      throw new LiveAvatarError(
        "Set LIVEAVATAR_ELEVENLABS_SECRET_ID, or ELEVENLABS_API_KEY so the bridge can register one.",
        503,
      );
    }
    this.cachedSecretId = await this.registerElevenLabsKey(this.cfg.elevenLabsApiKey);
    this.log?.info("liveavatar.secret.registered", {});
    return this.cachedSecretId;
  }

  /** Start a LITE-mode session that streams the avatar into our LiveKit room. */
  async startLiteSession(p: StartSessionParams): Promise<LiveAvatarSession> {
    const out = await this.postJson(this.cfg.liveAvatarSessionPath, {
      mode: "LITE",
      avatar_id: p.avatarId,
      elevenlabs_agent_config: { secret_id: p.secretId, agent_id: p.agentId },
      custom_livekit_config: {
        livekit_url: p.livekitUrl,
        livekit_room: p.livekitRoom,
        livekit_client_token: p.livekitWorkerToken,
      },
    });
    const nested = out.data as Record<string, unknown> | undefined;
    this.log?.info("liveavatar.session.start", { room: p.livekitRoom, avatar: p.avatarId });
    return { sessionId: (out.session_id ?? out.id ?? nested?.session_id) as string | undefined, raw: out };
  }
}
