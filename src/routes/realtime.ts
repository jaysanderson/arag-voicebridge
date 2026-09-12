/**
 * Realtime bootstrap routes: the single-use Scribe token for browser STT and the LiveAvatar
 * session. Both mint credentials, so both require a session/API key and carry their own limits.
 */
import {
  type App,
  badRequest,
  type Ctx,
  operationSchemas,
  serviceUnavailable,
  tooManyRequests,
  unauthorized,
} from "../../vendor/arag-platform/src/index.ts";
import { avatarEnabled } from "../config.ts";
import { openapi } from "../openapi.ts";
import type { ProductDeps } from "../server.ts";
import { mintLiveKitToken, newRoomName } from "../services/livekit.ts";
import { mintScribeToken } from "../services/scribe.ts";

/** Credential-minting endpoints are never anonymous, even when API_KEYS is unset. */
function requireIdentified(ctx: Ctx): void {
  if (!ctx.auth.admin && !ctx.auth.apiKey && !ctx.auth.session) {
    throw unauthorized(
      "A session or API key is required. Call POST /api/v1/session first (the demo UI does this automatically).",
    );
  }
}

export function registerRealtimeRoutes(app: App, deps: ProductDeps): void {
  app.post(
    "/api/v1/scribe-token",
    async (ctx) => {
      requireIdentified(ctx);
      const limit = deps.scribeLimiter.take(ctx.auth.apiKey ? `k:${ctx.auth.apiKey}` : `ip:${ctx.ip}`);
      if (!limit.ok) throw tooManyRequests(limit.retryAfter);
      const token = await mintScribeToken(deps.voice);
      // 15 minutes, single use — ElevenLabs consumes it when the WebSocket opens.
      return { token, expiresInSec: 900 };
    },
    { auth: "api", operationId: "createScribeToken", body: "none" },
  );

  app.post(
    "/api/v1/avatar/sessions",
    async (ctx) => {
      requireIdentified(ctx);
      if (!avatarEnabled(deps.voice)) {
        throw serviceUnavailable(
          "LiveAvatar is not configured: set LIVEAVATAR_API_KEY, LIVEKIT_URL, LIVEKIT_API_KEY and LIVEKIT_API_SECRET.",
        );
      }
      const { prospect: key } = ctx.body as { prospect: string };
      const prospect = deps.registry.require(key);
      if (!prospect.agent_id || !prospect.avatar_id) {
        throw badRequest(`Prospect "${key}" needs both agent_id and avatar_id for the avatar pane.`);
      }
      const room = newRoomName(key);
      const mint = (identity: string, name: string) =>
        mintLiveKitToken({
          apiKey: deps.voice.livekitApiKey,
          apiSecret: deps.voice.livekitApiSecret,
          identity,
          name,
          grant: { room, canPublish: true, canSubscribe: true },
        });
      const viewerToken = mint(`viewer-${Math.random().toString(36).slice(2, 10)}`, "viewer");
      const workerToken = mint("liveavatar-worker", "avatar");
      const secretId = await deps.liveAvatar.resolveSecretId();
      const session = await deps.liveAvatar.startLiteSession({
        avatarId: prospect.avatar_id,
        secretId,
        agentId: prospect.agent_id,
        livekitUrl: deps.voice.livekitUrl,
        livekitRoom: room,
        livekitWorkerToken: workerToken,
      });
      ctx.json(201, {
        livekit_url: deps.voice.livekitUrl,
        room,
        token: viewerToken,
        session_id: session.sessionId ?? null,
      });
    },
    {
      auth: "api",
      validate: operationSchemas(openapi, "/api/v1/avatar/sessions", "post"),
      operationId: "createAvatarSession",
    },
  );
}
