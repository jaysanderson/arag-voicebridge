/**
 * HTTP server for the ask-bridge service — built on Node's standard library only
 * (no framework, no dependencies). This keeps the demo factory install-free: a junior SE
 * runs it with bare `node`, nothing to npm-install.
 *
 * Routes:
 *   POST /v1/voice-answer       the one endpoint the ElevenAgent tool calls (SPEC §6.2.1)
 *   GET  /v1/prospects          non-secret registry for the control panel dropdown
 *   GET  /v1/prospects/:key     one prospect's non-secret config (greeting, voice_id, …)
 *   GET  /metrics               observability snapshot (SPEC §13)
 *   POST /admin/reload          hot-reload the registry JSON without a redeploy
 *   GET  /healthz               liveness
 */

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { config } from "./config.ts";
import { log } from "./logger.ts";
import {
  getRegistry,
  resolveProspect,
  reloadRegistry,
  ProspectNotFoundError,
} from "./registry.ts";
import { runTurn } from "./pipeline.ts";
import { recordTurn, snapshot } from "./metrics.ts";
import type { VoiceAnswerRequest, ProspectConfig } from "./types.ts";

const MAX_BODY_BYTES = 64 * 1024;

/** Strip secrets/internal IDs before sending registry data to the browser. */
function publicProspect(key: string, c: ProspectConfig) {
  return {
    key,
    display_name: c.display_name,
    locale: c.locale,
    greeting: c.greeting,
    handoff_msg: c.handoff_msg,
    agent_id: c.agent_id ?? null,
    voice_id: c.voice_id ?? null,
    golden_questions: c.golden_questions ?? [],
    // kb_id / ask_config / region are deliberately omitted — the browser never needs them.
  };
}

/** Resolve the CORS origin header value for a given request origin. */
function corsOrigin(reqOrigin: string | undefined): string | null {
  if (config.allowedOrigins.length === 0) return null;
  if (config.allowedOrigins.includes("*")) return "*";
  if (reqOrigin && config.allowedOrigins.includes(reqOrigin)) return reqOrigin;
  return null;
}

function applyCors(req: IncomingMessage, res: ServerResponse): void {
  const origin = corsOrigin(req.headers.origin);
  if (origin) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  }
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(payload);
}

/** Read and JSON-parse a request body, enforcing a size cap. */
function readJsonBody<T>(req: IncomingMessage): Promise<T> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error("request body too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8").trim();
      if (!raw) return resolve({} as T);
      try {
        resolve(JSON.parse(raw) as T);
      } catch {
        reject(new Error("invalid JSON body"));
      }
    });
    req.on("error", reject);
  });
}

/** A minimal server abstraction mirroring the slice of Fastify we used (listen()). */
export interface BridgeServer {
  listen(opts: { port: number; host: string }): Promise<void>;
  close(): Promise<void>;
}

export function buildServer(): BridgeServer {
  const server = createServer((req, res) => {
    handle(req, res).catch((err) => {
      log.error("server.unhandled", { message: (err as Error).message });
      if (!res.headersSent) sendJson(res, 500, { error: "internal error" });
    });
  });

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    applyCors(req, res);
    const method = req.method ?? "GET";
    const url = new URL(req.url ?? "/", "http://localhost");
    const path = url.pathname;

    if (method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    // --- liveness ---
    if (method === "GET" && path === "/healthz") return sendJson(res, 200, { ok: true });

    // --- registry (non-secret) ---
    if (method === "GET" && path === "/v1/prospects") {
      const reg = getRegistry();
      return sendJson(
        res,
        200,
        Object.entries(reg).map(([k, c]) => publicProspect(k, c)),
      );
    }

    if (method === "GET" && path.startsWith("/v1/prospects/")) {
      const key = decodeURIComponent(path.slice("/v1/prospects/".length));
      try {
        return sendJson(res, 200, publicProspect(key, resolveProspect(key)));
      } catch (err) {
        if (err instanceof ProspectNotFoundError) return sendJson(res, 404, { error: err.message });
        throw err;
      }
    }

    // --- metrics ---
    if (method === "GET" && path === "/metrics") {
      const prospect = url.searchParams.get("prospect") ?? undefined;
      return sendJson(res, 200, snapshot(prospect));
    }

    // --- hot-reload the registry ---
    if (method === "POST" && path === "/admin/reload") {
      const reg = reloadRegistry();
      log.info("registry.reload", { prospects: Object.keys(reg).length });
      return sendJson(res, 200, { ok: true, prospects: Object.keys(reg) });
    }

    // --- the one real endpoint ---
    if (method === "POST" && path === "/v1/voice-answer") {
      let body: VoiceAnswerRequest;
      try {
        body = await readJsonBody<VoiceAnswerRequest>(req);
      } catch (err) {
        return sendJson(res, 400, { error: (err as Error).message });
      }

      if (!body || typeof body.prospect !== "string" || typeof body.question !== "string") {
        return sendJson(res, 400, {
          error: "Body must include string fields `prospect` and `question`.",
        });
      }

      let prospect: ProspectConfig;
      try {
        prospect = resolveProspect(body.prospect);
      } catch (err) {
        if (err instanceof ProspectNotFoundError) return sendJson(res, 404, { error: err.message });
        throw err;
      }

      // Tie an AbortController to the connection so a dropped request (e.g. barge-in
      // cancelling the turn) cancels the in-flight ARAG call (SPEC §7.4).
      const controller = new AbortController();
      let finished = false;
      res.on("close", () => {
        if (!finished) controller.abort();
      });

      const result = await runTurn(body, prospect, controller.signal);
      finished = true;

      recordTurn({
        prospect: body.prospect,
        total: result.latency_ms.total,
        first_token: result.latency_ms.first_token,
        retrieve: result.latency_ms.retrieve,
        citations: result.citations.length,
        handoff: result.handoff,
        guard_trip:
          result.handoff && result.citations.length === 0 && result.latency_ms.retrieve === 0,
      });

      return sendJson(res, 200, result);
    }

    // --- fallthrough ---
    sendJson(res, 404, { error: `no route for ${method} ${path}` });
  }

  return {
    listen({ port, host }) {
      return new Promise((resolve) => server.listen(port, host, () => resolve()));
    },
    close() {
      return new Promise((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve())),
      );
    },
  };
}
