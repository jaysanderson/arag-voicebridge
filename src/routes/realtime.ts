/**
 * Realtime bootstrap routes: the single-use Scribe token for browser STT, server-side speech
 * synthesis and the voice-agent configuration. The credential-minting ones require a session or
 * API key and carry their own, tighter budgets.
 */
import { type App, type Ctx, operationSchemas, unauthorized } from "../../vendor/arag-platform/src/index.ts";
import { openapi } from "../openapi.ts";
import type { ProductDeps } from "../server.ts";
import { mintScribeToken } from "../services/scribe.ts";
import { synthesizeSpeech } from "../services/tts.ts";
import { voiceAgentConfig } from "../services/voiceAgent.ts";

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
      const token = await mintScribeToken(deps.voice);
      // 15 minutes, single use — ElevenLabs consumes it when the WebSocket opens.
      return { token, expiresInSec: 900 };
    },
    {
      auth: "api",
      operationId: "createScribeToken",
      body: "none",
      // Minting third-party credentials gets its own, much tighter budget.
      rateLimit: { rps: deps.voice.scribeRps, burst: deps.voice.scribeBurst },
    },
  );

  // The optional spoken brief. Synthesis is server-side so the ElevenLabs key never reaches a
  // browser, and it carries its own (tight) budget because every call costs per character.
  app.post(
    "/api/v1/speech",
    async (ctx) => {
      requireIdentified(ctx);
      const body = ctx.body as { text: string; voice_id?: string; prospect?: string };
      const prospect = body.prospect ? deps.registry.require(body.prospect) : undefined;
      const result = await synthesizeSpeech(deps.voice, {
        text: body.text,
        voiceId: body.voice_id || prospect?.voice_id,
      });
      ctx.res.writeHead(200, {
        "Content-Type": result.contentType,
        "Content-Length": result.audio.byteLength,
        "Cache-Control": "no-store",
        "X-Voice-Id": result.voiceId,
        "X-Model-Id": result.modelId,
      });
      ctx.res.end(Buffer.from(result.audio));
    },
    {
      auth: "api",
      validate: operationSchemas(openapi, "/api/v1/speech", "post"),
      operationId: "createSpeech",
      rateLimit: { rps: deps.voice.ttsRps, burst: deps.voice.ttsBurst },
    },
  );

  // What a partner has to paste into the ElevenLabs dashboard to wire an agent to this deployment.
  // Non-secret by construction: an agent id, a URL, a JSON schema and a prompt.
  app.get(
    "/api/v1/voice-agent",
    (ctx) => {
      const prospect = deps.registry.require(String(ctx.queryObj.prospect ?? ""));
      return voiceAgentConfig(
        prospect,
        deps.voice,
        deps.env.publicUrl || `http://localhost:${deps.env.port}`,
      );
    },
    {
      auth: "api",
      validate: operationSchemas(openapi, "/api/v1/voice-agent", "get"),
      operationId: "getVoiceAgent",
    },
  );
}
