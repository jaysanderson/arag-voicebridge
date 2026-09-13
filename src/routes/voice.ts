/**
 * Voice routes: one turn (`/api/v1/voice-answer`, plus the `/v1/voice-answer` compatibility
 * alias used by already-configured ElevenLabs agents) and the ambient brief (`/api/v1/brief`).
 */
import { type App, type Ctx, operationSchemas } from "../../vendor/arag-platform/src/index.ts";
import { openapi } from "../openapi.ts";
import type { ProductDeps } from "../server.ts";
import { runBrief } from "../services/brief.ts";
import { liveBudget } from "../services/budget.ts";
import { runTurn, TurnTrace } from "../services/pipeline.ts";
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
    // Tracing is opt-in per request: the agent's tool call never asks for it, the Ask tester
    // always does, and the collected steps are what the pipeline stepper renders.
    const trace = body.trace === true ? new TurnTrace() : undefined;
    try {
      const { response, guardTrip } = await runTurn(body, prospect, deps.turnDeps(), { signal, trace });
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
      if (trace) {
        trace.add("record", "Return and record", "ok", `${response.latency_ms.total} ms end to end`);
        return { ...response, pipeline: trace.steps };
      }
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
      // The brief costs an LLM call and a listening client fires it continuously: its own budget.
      rateLimit: liveBudget(() => ({ rps: deps.voice.briefRps, burst: deps.voice.briefBurst })),
    },
  );
}
