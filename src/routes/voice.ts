/**
 * Voice routes: one turn (`/api/v1/voice-answer`, plus the `/v1/voice-answer` compatibility
 * alias used by already-configured ElevenLabs agents) and the ambient brief (`/api/v1/brief`).
 */
import {
  type App,
  type Ctx,
  operationSchemas,
  tooManyRequests,
} from "../../vendor/arag-platform/src/index.ts";
import { openapi } from "../openapi.ts";
import type { ProductDeps } from "../server.ts";
import { runBrief } from "../services/brief.ts";
import { runTurn } from "../services/pipeline.ts";
import type { VoiceAnswerRequest } from "../types.ts";

/** Abort the upstream ARAG call when the client hangs up (barge-in cancels the turn). */
function abortOnClose(ctx: Ctx): { signal: AbortSignal; done: () => void } {
  const controller = new AbortController();
  let finished = false;
  const onClose = () => {
    if (!finished) controller.abort();
  };
  ctx.res.on("close", onClose);
  return {
    signal: controller.signal,
    done: () => {
      finished = true;
      ctx.res.off("close", onClose);
    },
  };
}

export function registerVoiceRoutes(app: App, deps: ProductDeps): void {
  const handleTurn = async (ctx: Ctx) => {
    const body = ctx.body as VoiceAnswerRequest;
    const prospect = deps.registry.require(body.prospect);
    const { signal, done } = abortOnClose(ctx);
    try {
      const { response, guardTrip } = await runTurn(body, prospect, deps.turnDeps(), { signal });
      deps.metrics.record({
        prospect: body.prospect,
        conversation_id: body.conversation_id,
        // Never retain the text of an input that tripped a safety guard.
        question: guardTrip ? undefined : body.question.slice(0, 500),
        total: response.latency_ms.total,
        first_token: response.latency_ms.first_token,
        retrieve: response.latency_ms.retrieve,
        citations: response.citations.length,
        handoff: response.handoff,
        guard_trip: guardTrip,
        reason: response.handoff_reason,
        source: "voice-answer",
      });
      return response;
    } finally {
      done();
    }
  };

  app.post("/api/v1/voice-answer", handleTurn, {
    auth: "api",
    validate: operationSchemas(openapi, "/api/v1/voice-answer", "post"),
    operationId: "voiceAnswer",
    bodyLimit: 64 * 1024,
  });

  // Compatibility alias for agents configured against the original bridge URL.
  app.post("/v1/voice-answer", handleTurn, {
    auth: "api",
    validate: operationSchemas(openapi, "/v1/voice-answer", "post"),
    operationId: "voiceAnswerLegacy",
    bodyLimit: 64 * 1024,
  });

  app.post(
    "/api/v1/brief",
    async (ctx) => {
      // The brief fires every ~1.5 s while listening, so it carries its own stricter budget.
      const limit = deps.briefLimiter.take(ctx.auth.apiKey ? `k:${ctx.auth.apiKey}` : `ip:${ctx.ip}`);
      if (!limit.ok) throw tooManyRequests(limit.retryAfter);
      const body = ctx.body as {
        prospect: string;
        text: string;
        transcript?: string;
        prev?: unknown;
        generative_model?: string;
      };
      const prospect = deps.registry.require(body.prospect);
      const { signal, done } = abortOnClose(ctx);
      try {
        return await runBrief(
          {
            text: body.text,
            transcript: body.transcript,
            prev: body.prev,
            model: body.generative_model,
          },
          prospect,
          { client: deps.clients.for(prospect), voice: deps.voice, log: deps.log },
          { signal },
        );
      } finally {
        done();
      }
    },
    {
      auth: "api",
      validate: operationSchemas(openapi, "/api/v1/brief", "post"),
      operationId: "brief",
      bodyLimit: 128 * 1024,
    },
  );
}
