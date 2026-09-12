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
import {
  ListenSessionEnded,
  type ListenSessionExport,
  type ListenSortKey,
  type TranscriptChunk,
} from "../services/listen.ts";

/**
 * Neutralise text that came from a conversation or a Knowledge Box before it goes into a
 * Markdown file.
 *
 * The transcript is attacker-reachable by design — anything that can POST JSON can put words in
 * it — and citation titles come from content. A handover note is pasted into wikis, tickets and
 * chat tools, many of which render raw HTML inside Markdown, so an unescaped `<img onerror=…>`
 * spoken into a call would execute wherever the note was later opened. Angle brackets and
 * backticks are the only characters that can change how the note is interpreted; escaping them
 * keeps the note readable while making it inert.
 */
export function mdSafe(text: unknown): string {
  return String(text ?? "")
    .replace(/[<>]/g, (c) => (c === "<" ? "&lt;" : "&gt;"))
    .replace(/`/g, "\u2018")
    .replace(/\r?\n/g, " ")
    .trim();
}

/** The Markdown handover note: the final brief, how it got there, the sources and the transcript. */
export function exportMarkdown(s: ListenSessionExport, displayName: string): string {
  const b = (s.brief ?? {}) as Record<string, unknown>;
  const str = (k: string) => mdSafe(typeof b[k] === "string" ? b[k] : "");
  const bullets = (k: string) =>
    (Array.isArray(b[k]) ? (b[k] as unknown[]) : [])
      .map((x) => mdSafe(x))
      .filter(Boolean)
      .map((x) => `- ${x}`)
      .join("\n");
  const section = (heading: string, body: string) => (body ? `\n## ${heading}\n\n${body}\n` : "");

  const header =
    `# Conversation ${mdSafe(s.id.slice(0, 8))} — ${mdSafe(displayName)}\n\n` +
    `- Started: ${s.createdAt}\n` +
    `- ${s.status === "ended" ? `Ended: ${s.endedAt ?? s.updatedAt}` : "Status: live"}\n` +
    `- Duration: ${s.durationSec}s\n` +
    `- Brief versions: ${s.briefVersion}\n` +
    `- Refreshes: ${s.stats.refreshes} (skipped ${s.stats.skipped}, failed ${s.stats.failures})\n` +
    `- Refresh latency: p50 ${s.stats.p50LatencyMs} ms · p95 ${s.stats.p95LatencyMs} ms\n`;

  const brief =
    section("Brief", [str("topic") && `**${str("topic")}**`, str("summary")].filter(Boolean).join("\n\n")) +
    section(
      "Who and what they want",
      [str("caller_profile"), str("their_goal")].filter(Boolean).join("\n\n"),
    ) +
    section("Key points", bullets("key_points")) +
    section("Ask them", bullets("suggested_questions")) +
    section("You could say", bullets("suggested_answers")) +
    section("Recommend", bullets("recommended_products"));

  const sources = section(
    "Sources",
    s.citations
      .map((c) => {
        // Only an http(s) source becomes a link; anything else is shown as plain text.
        const url = /^https?:\/\//i.test(String(c.url ?? "")) ? mdSafe(c.url) : "";
        return `- ${mdSafe(c.title)}${url ? ` — ${url}` : ""}`;
      })
      .join("\n"),
  );
  const history = section(
    "How the brief evolved",
    s.briefHistory.map((h) => `- v${h.version} at ${h.at} (${h.latencyMs} ms)`).join("\n"),
  );
  const transcript = section(
    "Transcript",
    s.transcript.map((t) => `**${mdSafe(t.speaker)}:** ${mdSafe(t.text)}`).join("\n\n"),
  );
  return `${header}${brief}${sources}${history}${transcript}`;
}

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
    (ctx) => {
      const q = ctx.queryObj as Record<string, unknown>;
      const limit = (q.limit as number | undefined) ?? 25;
      const offset = (q.offset as number | undefined) ?? 0;
      const { items, total } = deps.listen.query({
        prospect: q.prospect as string | undefined,
        status: q.status as "live" | "ended" | undefined,
        q: q.q as string | undefined,
        from: q.from as string | undefined,
        to: q.to as string | undefined,
        sort: q.sort as ListenSortKey | undefined,
        order: q.order as "asc" | "desc" | undefined,
        limit,
        offset,
      });
      return { items, total, limit, offset };
    },
    {
      auth: "api",
      validate: operationSchemas(openapi, "/api/v1/listen/sessions", "get"),
      operationId: "listListenSessions",
    },
  );

  app.get(
    "/api/v1/listen/sessions/:id/export",
    (ctx) => {
      const record = deps.listen.exportSession(ctx.params.id!);
      if (ctx.queryObj.format === "markdown") {
        const prospect = deps.registry.get(record.prospect);
        ctx.text(
          200,
          exportMarkdown(record, prospect?.display_name ?? record.prospect),
          "text/markdown; charset=utf-8",
          { "Content-Disposition": `attachment; filename="conversation-${record.id.slice(0, 8)}.md"` },
        );
        return;
      }
      return record;
    },
    {
      auth: "api",
      validate: operationSchemas(openapi, "/api/v1/listen/sessions/{id}/export", "get"),
      operationId: "exportListenSession",
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

  app.post(
    "/api/v1/listen/sessions/:id/refresh",
    async (ctx) => {
      const session = deps.listen.require(ctx.params.id!);
      if (session.status === "ended") throw conflict(`Listen session "${session.id}" has ended`);
      const view = await deps.listen.refresh(session.id);
      return view ?? deps.listen.view(deps.listen.require(session.id));
    },
    {
      auth: "api",
      operationId: "refreshListenSession",
      body: "none",
      rateLimit: briefBudget,
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
