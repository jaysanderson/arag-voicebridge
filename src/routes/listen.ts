/**
 * Real-time listening routes — the product's hero surface.
 *
 * Deliberately transport-agnostic: a session is opened, conversation is appended as chunks from
 * whatever is producing them (a realtime STT socket, a telephony webhook, a meeting bot, a person
 * typing), and the evolving brief is read over SSE or by polling. Nothing here knows about
 * ElevenLabs, so a customer can bring their own transcription.
 */
import { type App, conflict, operationSchemas } from "../../vendor/arag-platform/src/index.ts";
import { openapi } from "../openapi.ts";
import type { ProductDeps } from "../server.ts";
import { ListenSessionEnded, type TranscriptChunk } from "../services/listen.ts";

export function registerListenRoutes(app: App, deps: ProductDeps): void {
  // The brief behind a session costs an LLM call per refresh, so sessions carry the same
  // stricter budget as the stateless /api/v1/brief primitive.
  const briefBudget = { rps: deps.voice.briefRps, burst: deps.voice.briefBurst };

  app.post(
    "/api/v1/listen/sessions",
    (ctx) => {
      const body = ctx.body as {
        prospect: string;
        locale?: string;
        metadata?: Record<string, unknown>;
        generative_model?: string;
      };
      const session = deps.listen.create(body);
      ctx.json(201, session, { Location: `/api/v1/listen/sessions/${session.id}` });
    },
    {
      auth: "api",
      validate: operationSchemas(openapi, "/api/v1/listen/sessions", "post"),
      operationId: "createListenSession",
      rateLimit: briefBudget,
    },
  );

  app.get(
    "/api/v1/listen/sessions",
    (ctx) => ({
      items: deps.listen.list({
        prospect: ctx.queryObj.prospect as string | undefined,
        limit: (ctx.queryObj.limit as number | undefined) ?? 25,
      }),
    }),
    {
      auth: "api",
      validate: operationSchemas(openapi, "/api/v1/listen/sessions", "get"),
      operationId: "listListenSessions",
    },
  );

  app.get(
    "/api/v1/listen/sessions/:id",
    (ctx) => {
      const session = deps.listen.require(ctx.params.id!);
      return deps.listen.view(session, (ctx.queryObj.transcript_tail as number | undefined) ?? 50);
    },
    {
      auth: "api",
      validate: operationSchemas(openapi, "/api/v1/listen/sessions/{id}", "get"),
      operationId: "getListenSession",
    },
  );

  app.post(
    "/api/v1/listen/sessions/:id/transcript",
    (ctx) => {
      const { chunks } = ctx.body as { chunks: TranscriptChunk[] };
      try {
        const { session, decision } = deps.listen.append(ctx.params.id!, chunks);
        const refresh = decision.refresh
          ? "started"
          : decision.reason === "too-soon"
            ? "scheduled"
            : "skipped";
        ctx.json(202, { session, refresh, reason: decision.reason });
      } catch (err) {
        if (err instanceof ListenSessionEnded) throw conflict(err.message);
        throw err;
      }
    },
    {
      auth: "api",
      validate: operationSchemas(openapi, "/api/v1/listen/sessions/{id}/transcript", "post"),
      operationId: "appendListenTranscript",
      bodyLimit: 256 * 1024,
    },
  );

  app.get(
    "/api/v1/listen/sessions/:id/events",
    (ctx) => {
      const session = deps.listen.require(ctx.params.id!);
      const sse = ctx.sse();
      // Send the current state immediately so a late subscriber is not staring at an empty pane.
      sse.send("brief", {
        brief: session.brief,
        version: session.briefVersion,
        citations: session.citations,
        stats: session.stats,
      });
      sse.send("status", { status: session.status });
      if (session.status === "ended") {
        sse.close();
        return;
      }
      const unsubscribe = deps.listen.subscribe(session.id, (event) => {
        sse.send(event.type, event);
        if (event.type === "status" && event.status === "ended") sse.close();
      });
      sse.onClose(unsubscribe);
    },
    { auth: "api", noRateLimit: true, operationId: "listenSessionEvents" },
  );

  app.delete("/api/v1/listen/sessions/:id", (ctx) => deps.listen.end(ctx.params.id!), {
    auth: "api",
    operationId: "endListenSession",
  });
}
