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
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve, normalize, extname } from "node:path";
import { config, avatarEnabled, scribeEnabled } from "./config.ts";
import { log } from "./logger.ts";
import {
  getRegistry,
  resolveProspect,
  reloadRegistry,
  ProspectNotFoundError,
} from "./registry.ts";
import { runTurn } from "./pipeline.ts";
import { recordTurn, snapshot } from "./metrics.ts";
import { mintLiveKitToken, newRoomName } from "./livekit.ts";
import { resolveSecretId, startLiteSession, LiveAvatarError } from "./liveavatar.ts";
import { mintScribeToken, ScribeError } from "./scribe.ts";
import { runBrief } from "./brief.ts";
import { fetchModels } from "./models.ts";
import { fetchVoices } from "./voices.ts";
import type { VoiceAnswerRequest, ProspectConfig } from "./types.ts";

const MAX_BODY_BYTES = 64 * 1024;

// Static web UI (the control panel) lives in bridge/public and is served at the root,
// so the deployed bridge URL *is* the interface — no separate static server needed.
const PUBLIC_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..", "public");

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

/**
 * Serve a file from PUBLIC_DIR. Path-traversal safe: the resolved path must stay inside
 * PUBLIC_DIR. Returns true if it served something, false if not found (caller 404s).
 */
async function serveStatic(urlPath: string, res: ServerResponse): Promise<boolean> {
  const rel = urlPath === "/" ? "/index.html" : urlPath;
  const filePath = normalize(resolve(PUBLIC_DIR, "." + rel));
  if (filePath !== PUBLIC_DIR && !filePath.startsWith(PUBLIC_DIR + "/")) return false; // traversal
  try {
    const data = await readFile(filePath);
    const type = CONTENT_TYPES[extname(filePath)] ?? "application/octet-stream";
    // no-store so the demo UI is always fresh (avoids a stale app.js lingering in the browser).
    res.writeHead(200, { "Content-Type": type, "Cache-Control": "no-store" });
    res.end(data);
    return true;
  } catch {
    return false;
  }
}

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
    // True when the LiveAvatar pane can run for this prospect (creds set + avatar_id present).
    avatar_ready: avatarEnabled() && Boolean(c.avatar_id),
    // True when the ambient "Listen" mode can run (an ElevenLabs key is set for Scribe STT).
    scribe_ready: scribeEnabled(),
    // kb_id / ask_config / region / avatar_id are deliberately omitted — the browser never needs them.
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

    // --- Available ElevenLabs voices (powers the Call voice dropdown) ---
    if (method === "GET" && path === "/v1/voices") {
      if (!scribeEnabled()) return sendJson(res, 503, { error: "voices not configured" });
      try {
        return sendJson(res, 200, { voices: await fetchVoices() });
      } catch (err) {
        return sendJson(res, 502, { error: (err as Error).message });
      }
    }

    // --- Available generative models for a prospect's KB (powers the model dropdown) ---
    if (method === "GET" && path === "/v1/models") {
      const key = url.searchParams.get("prospect") ?? "";
      let prospect: ProspectConfig;
      try {
        prospect = resolveProspect(key);
      } catch (err) {
        if (err instanceof ProspectNotFoundError) return sendJson(res, 404, { error: err.message });
        throw err;
      }
      const out = await fetchModels(prospect);
      return sendJson(res, 200, out);
    }

    // --- Structured live brief (ambient Listen): ARAG answer_json_schema → laid-out sections ---
    if (method === "POST" && path === "/v1/brief") {
      let body: {
        prospect?: string;
        text?: string;
        transcript?: string;
        prev?: unknown;
        schema?: unknown;
        generative_model?: string;
      };
      try {
        body = await readJsonBody(req);
      } catch (err) {
        return sendJson(res, 400, { error: (err as Error).message });
      }
      if (!body || typeof body.prospect !== "string" || typeof body.text !== "string") {
        return sendJson(res, 400, { error: "Body must include string fields `prospect` and `text`." });
      }
      let prospect: ProspectConfig;
      try {
        prospect = resolveProspect(body.prospect);
      } catch (err) {
        if (err instanceof ProspectNotFoundError) return sendJson(res, 404, { error: err.message });
        throw err;
      }
      const controller = new AbortController();
      let finished = false;
      res.on("close", () => { if (!finished) controller.abort(); });
      const result = await runBrief(
        {
          text: body.text,
          transcript: typeof body.transcript === "string" ? body.transcript : undefined,
          prev: body.prev,
          schema: body.schema,
          model: body.generative_model,
        },
        prospect,
        controller.signal,
      );
      finished = true;
      return sendJson(res, 200, result);
    }

    // --- Scribe single-use token for the ambient Listen mode (browser STT) ---
    if (method === "GET" && path === "/v1/scribe-token") {
      if (!scribeEnabled()) return sendJson(res, 503, { error: "scribe not configured" });
      try {
        const token = await mintScribeToken();
        return sendJson(res, 200, { token });
      } catch (err) {
        const status = err instanceof ScribeError ? (err.status ?? 502) : 500;
        log.error("scribe.token.fail", { message: (err as Error).message });
        return sendJson(res, status, { error: `scribe token failed: ${(err as Error).message}` });
      }
    }

    // --- LiveAvatar session: mint a LiveKit room + viewer token, start a LITE session ---
    if (method === "POST" && path === "/v1/avatar/session") {
      if (!avatarEnabled()) {
        return sendJson(res, 503, { error: "avatar not configured" });
      }
      let body: { prospect?: string };
      try {
        body = await readJsonBody(req);
      } catch (err) {
        return sendJson(res, 400, { error: (err as Error).message });
      }
      if (!body || typeof body.prospect !== "string") {
        return sendJson(res, 400, { error: "Body must include string field `prospect`." });
      }
      let prospect: ProspectConfig;
      try {
        prospect = resolveProspect(body.prospect);
      } catch (err) {
        if (err instanceof ProspectNotFoundError) return sendJson(res, 404, { error: err.message });
        throw err;
      }
      if (!prospect.agent_id || !prospect.avatar_id) {
        return sendJson(res, 400, {
          error: `Prospect "${body.prospect}" needs both agent_id and avatar_id for the avatar.`,
        });
      }

      try {
        const room = newRoomName(body.prospect);
        const viewerToken = mintLiveKitToken({
          apiKey: config.livekitApiKey,
          apiSecret: config.livekitApiSecret,
          identity: `viewer-${Math.random().toString(36).slice(2, 10)}`,
          name: "viewer",
          grant: { room, canPublish: true, canSubscribe: true },
        });
        const workerToken = mintLiveKitToken({
          apiKey: config.livekitApiKey,
          apiSecret: config.livekitApiSecret,
          identity: "liveavatar-worker",
          name: "avatar",
          grant: { room, canPublish: true, canSubscribe: true },
        });
        const secretId = await resolveSecretId();
        const session = await startLiteSession({
          avatarId: prospect.avatar_id,
          secretId,
          agentId: prospect.agent_id,
          livekitUrl: config.livekitUrl,
          livekitRoom: room,
          livekitWorkerToken: workerToken,
        });
        return sendJson(res, 200, {
          livekit_url: config.livekitUrl,
          room,
          token: viewerToken,
          session_id: session.sessionId ?? null,
        });
      } catch (err) {
        const status = err instanceof LiveAvatarError ? (err.status ?? 502) : 500;
        log.error("avatar.session.fail", { prospect: body.prospect, message: (err as Error).message });
        return sendJson(res, status, { error: `avatar session failed: ${(err as Error).message}` });
      }
    }

    // --- static web UI (GET only) — served from bridge/public ---
    if (method === "GET" && (await serveStatic(path, res))) return;

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
