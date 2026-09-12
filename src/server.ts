/**
 * App wiring for VoiceBridge. Everything HTTP lives here and in `routes/`; the domain logic is
 * in `services/`. Exported as a factory so tests boot the whole product in-process against the
 * mock ARAG server.
 */
import { resolve } from "node:path";
import {
  App,
  type AragClient,
  cors,
  log as defaultLog,
  HttpError,
  healthRoutes,
  type Job,
  JobManager,
  type Logger,
  notFound,
  PLATFORM_VERSION,
  type PlatformEnv,
  Store,
  securityHeaders,
  startMockArag,
  validationError,
} from "../vendor/arag-platform/src/index.ts";
import { assertVoiceConfig, avatarEnabled, scribeEnabled, type VoiceConfig } from "./config.ts";
import { openapi, VERSION } from "./openapi.ts";
import { registerAdminRoutes } from "./routes/admin.ts";
import { registerJobRoutes } from "./routes/jobs.ts";
import { registerListenRoutes } from "./routes/listen.ts";
import { registerProspectRoutes } from "./routes/prospects.ts";
import { GOLDEN_EVAL_JOB, registerQualityRoutes } from "./routes/quality.ts";
import { registerRealtimeRoutes } from "./routes/realtime.ts";
import { registerVoiceRoutes } from "./routes/voice.ts";
import { runBrief } from "./services/brief.ts";
import { AragClientPool } from "./services/clientPool.ts";
import { type GoldenEvalResult, GoldenEvalStore, runGoldenEval } from "./services/goldenEval.ts";
import { ListenService, ListenSessionNotFound } from "./services/listen.ts";
import { LiveAvatarClient } from "./services/liveavatar.ts";
import { MetricsService } from "./services/metrics.ts";
import type { AskCapable, TurnDeps } from "./services/pipeline.ts";
import { ProspectNotFoundError, ProspectRegistry, ValidationFailed } from "./services/registry.ts";
import { mockSeed } from "./services/seed.ts";
import type { ProspectConfig } from "./types.ts";

export interface Usage {
  startedAt: number;
  requests: number;
  aragCalls: number;
  aragErrors: number;
  aragMs: number;
}

/** Everything the route modules need. Assembled once by `createProduct`. */
export interface ProductDeps {
  env: PlatformEnv;
  voice: VoiceConfig;
  log: Logger;
  store: Store;
  jobs: JobManager;
  registry: ProspectRegistry;
  clients: { for(p: ProspectConfig): AragClient; clear(): void };
  metrics: MetricsService;
  evals: GoldenEvalStore;
  listen: ListenService;
  liveAvatar: LiveAvatarClient;
  usage: Usage;
  platformVersion: string;
  /** Pipeline dependencies (client resolver + config + logger). */
  turnDeps(): TurnDeps;
}

export interface Product {
  name: string;
  version: string;
  app: App;
  deps: ProductDeps;
  close(): Promise<void>;
}

const HERE = resolve(import.meta.dirname ?? ".", "..");

export interface CreateOptions {
  log?: Logger;
  /** Persist stores to DATA_DIR (tests pass false). */
  persist?: boolean;
  /** Seed the registry from this file when the store is empty. */
  registrySeedFile?: string;
  /** Injectable fetch for the LiveAvatar client (tests only — never set in production). */
  liveAvatarFetch?: (input: string, init?: RequestInit) => Promise<Response>;
}

export async function createProduct(
  env: PlatformEnv,
  voice: VoiceConfig,
  opts: CreateOptions = {},
): Promise<Product> {
  const log = opts.log ?? defaultLog;
  assertVoiceConfig(env, voice);
  const usage: Usage = { startedAt: Date.now(), requests: 0, aragCalls: 0, aragErrors: 0, aragMs: 0 };

  // ARAG: live per-prospect clients, or the in-process mock when ARAG_MOCK=1 (no credentials).
  let mock: Awaited<ReturnType<typeof startMockArag>> | null = null;
  if (env.arag.mock) {
    mock = await startMockArag({ seed: mockSeed(), log });
    log.warn("arag.mock", { url: mock.url, documents: mockSeed().length });
  }
  const clients = new AragClientPool({
    env,
    voice,
    log,
    mock: mock ? { url: mock.url, kbId: mock.kbId, apiKey: mock.apiKey } : null,
    onRequest: (i) => {
      usage.aragCalls++;
      usage.aragMs += i.ms;
      if (i.error || (i.status ?? 0) >= 400) usage.aragErrors++;
      log.debug("arag.request", {
        method: i.method,
        path: i.path,
        status: i.status,
        ms: Math.round(i.ms),
        error: i.error,
      });
    },
  });

  const store = new Store(env.dataDir, { persist: opts.persist ?? true });
  const jobs = new JobManager(store, log);
  const registry = new ProspectRegistry({ store, log, voice });
  registry.seedFromFile(opts.registrySeedFile ?? resolve(HERE, "config", "prospects.example.json"), {
    kbId: env.arag.kbId,
  });
  const metrics = new MetricsService({ store, cap: voice.turnLogLimit });
  const evals = new GoldenEvalStore(store);
  const liveAvatar = new LiveAvatarClient(voice, { log, fetch: opts.liveAvatarFetch });
  // Real-time listening: sessions own the throttling, the evolving brief and the citations seen
  // across a call. The brief itself is the same primitive POST /api/v1/brief exposes.
  const listen = new ListenService({
    store,
    log,
    voice,
    prospect: (key) => registry.require(key),
    brief: (req, prospect) => runBrief(req, prospect, { client: clients.for(prospect), voice, log }),
  });

  const deps: ProductDeps = {
    env,
    voice,
    log,
    store,
    jobs,
    registry,
    clients,
    metrics,
    evals,
    listen,
    liveAvatar,
    usage,
    platformVersion: PLATFORM_VERSION,
    turnDeps: () => ({
      clientFor: (p: ProspectConfig): AskCapable => clients.for(p),
      voice,
      log,
    }),
  };

  // Golden-set evaluation runs in-process against the same pipeline the agent uses.
  jobs.register<{ prospect: string }, GoldenEvalResult>(GOLDEN_EVAL_JOB, async (ctx) => {
    const prospect = registry.require(ctx.job.input.prospect);
    const total = (prospect.golden_questions ?? []).length;
    ctx.emit("golden-eval", "start", { message: `${total} questions`, progress: 0 });
    const result = await runGoldenEval(
      prospect,
      { ...deps.turnDeps(), metrics },
      {
        signal: ctx.signal,
        onCase: (c, index, count) =>
          ctx.emit("question", c.passed ? "ok" : "error", {
            message: `${index}/${count} ${c.passed ? "pass" : "FAIL"} · ${c.q}`,
            ms: c.latency_ms,
            progress: count ? index / count : 1,
            data: { q: c.q, passed: c.passed, handoff: c.handoff, citations: c.citations },
          }),
      },
    );
    evals.save(result);
    ctx.emit("golden-eval", result.ok ? "ok" : "error", {
      message: `${result.passed}/${result.total} passed · p50 ${result.latency_ms.p50} ms`,
      progress: 1,
    });
    return result;
  });

  // ── HTTP ─────────────────────────────────────────────────────────────────────
  const app = new App({ env, log });
  // The console talks WebRTC/WebSocket to ElevenLabs (agent + Scribe) and to LiveKit for the
  // avatar pane; everything else stays on the platform's narrow default CSP.
  app.use(
    securityHeaders({
      connectSrc: [
        "https://api.elevenlabs.io",
        "wss://api.elevenlabs.io",
        "https://api.us.elevenlabs.io",
        "wss://api.us.elevenlabs.io",
        "https://*.livekit.cloud",
        "wss://*.livekit.cloud",
      ],
      mediaSrc: ["https://storage.googleapis.com"],
    }),
    cors(),
  );
  app.use(async (_ctx, next) => {
    usage.requests++;
    await next();
  });
  // Product-specific error mapping (registry + integration errors → problem+json).
  app.errorMapper = (err: unknown): HttpError | null => {
    if (err instanceof ProspectNotFoundError) {
      return new HttpError(404, "Not found", err.message, { extra: { known: err.known } });
    }
    if (err instanceof ValidationFailed) return validationError(err.errors, "body");
    if (err instanceof ListenSessionNotFound) return notFound("Listen session");
    const e = err as { name?: string; message?: string; status?: number };
    if (["ScribeError", "VoicesError", "TtsError", "LiveAvatarError"].includes(e?.name ?? "")) {
      const status = e.status && e.status >= 400 && e.status <= 599 ? e.status : 502;
      return new HttpError(
        status === 503 ? 503 : status,
        status === 503 ? "Service unavailable" : "Upstream error",
        e.message,
      );
    }
    return null;
  };

  // Readiness probes the default prospect's Knowledge Box, but the console polls /readyz every
  // 15 s per open tab — cache the upstream check so a demo audience cannot hammer ARAG.
  let readyCache: { at: number; arag: Record<string, unknown> } | null = null;
  const READY_TTL_MS = 30_000;
  healthRoutes(app, async () => {
    if (!readyCache || Date.now() - readyCache.at > READY_TTL_MS) {
      const first = registry.list()[0];
      const arag = first ? await clients.for(first).health() : { ok: env.arag.mock };
      readyCache = { at: Date.now(), arag: arag as Record<string, unknown> };
    }
    return {
      version: VERSION,
      prospects: registry.size,
      arag: { ...readyCache.arag, mock: env.arag.mock },
    };
  });
  app.docs("/api/v1", openapi, { title: "VoiceBridge API" });

  registerListenRoutes(app, deps);
  registerVoiceRoutes(app, deps);
  registerProspectRoutes(app, deps);
  registerRealtimeRoutes(app, deps);
  registerQualityRoutes(app, deps);
  registerJobRoutes(app, deps);
  registerAdminRoutes(app, deps);

  // White-label branding: public, unauthenticated and uncached-by-default so a partner can change
  // it with a restart. The UI kit shell fetches this at boot.
  app.get("/api/v1/branding", () => voice.branding, { operationId: "getBranding", noRateLimit: true });

  // Which optional integrations are switched on. Booleans and non-secret detail only — this tells
  // the Settings view why the microphone, the spoken brief or the avatar pane is unavailable,
  // without leaking a key. ElevenLabs is marked primary: with a key set it powers the default
  // out-of-the-box experience (Scribe transcription, the voice agent, the spoken brief), and
  // without one the product degrades to the sample and typed conversation.
  app.get(
    "/api/v1/integrations",
    () => {
      const el = scribeEnabled(voice);
      return {
        items: [
          {
            id: "arag",
            name: "Progress Agentic RAG",
            configured: true,
            primary: true,
            purpose: "Retrieval and generation behind every brief and answer",
            detail: env.arag.mock ? "mock Knowledge Box (no credentials)" : env.arag.baseUrl,
            setup: "ARAG_KB_ID, ARAG_API_KEY, ARAG_REGION",
            capabilities: [
              { name: "Grounded brief", detail: "answer_json_schema structured output", enabled: true },
              {
                name: "Grounded answers",
                detail: "/ask with citations and a handoff sentinel",
                enabled: true,
              },
            ],
            config: { endpoint: env.arag.mock ? "in-process mock" : env.arag.baseUrl },
          },
          {
            id: "elevenlabs",
            name: "ElevenLabs",
            configured: el,
            primary: true,
            purpose: "Live transcription, the voice agent, and the optional spoken brief",
            detail: voice.elevenLabsApiBase,
            setup: "ELEVENLABS_API_KEY",
            capabilities: [
              {
                name: "Scribe v2 Realtime",
                detail: "Default microphone transcription in Live, over a single-use token",
                enabled: el,
              },
              {
                name: "Conversational AI agents",
                detail: "Default voice channel; calls /api/v1/voice-answer as a custom server tool",
                enabled: el,
              },
              {
                name: "Text-to-speech",
                detail: "Optional spoken brief and whisper cue, off by default",
                enabled: el,
              },
              {
                name: "Voice library",
                detail: "Voice selection for the agent and the spoken brief",
                enabled: el,
              },
            ],
            config: {
              apiBase: voice.elevenLabsApiBase,
              scribeModel: voice.scribeModel,
              ttsModel: voice.ttsModelId,
              ttsVoiceId: voice.ttsVoiceId || "per-prospect or library default",
              defaultAgentId: voice.defaultAgentId || "set per prospect",
            },
          },
          {
            id: "livekit",
            name: "LiveKit",
            configured: Boolean(voice.livekitUrl && voice.livekitApiKey && voice.livekitApiSecret),
            primary: false,
            purpose: "Media transport for the video avatar pane",
            detail: voice.livekitUrl || undefined,
            setup: "LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET",
            capabilities: [
              {
                name: "Room tokens",
                detail: "Minted server-side per avatar session",
                enabled: Boolean(voice.livekitUrl),
              },
            ],
            config: { url: voice.livekitUrl || "not set" },
          },
          {
            id: "liveavatar",
            name: "LiveAvatar",
            configured: avatarEnabled(voice),
            primary: false,
            purpose: "The video avatar for the voice agent",
            detail: voice.liveAvatarApiBase,
            setup: "LIVEAVATAR_API_KEY (plus LiveKit and ElevenLabs)",
            capabilities: [
              {
                name: "Lite sessions",
                detail: "Driven by the same ElevenLabs agent",
                enabled: avatarEnabled(voice),
              },
            ],
            config: { apiBase: voice.liveAvatarApiBase },
          },
        ],
      };
    },
    { auth: "api", operationId: "listIntegrations" },
  );

  // Session for the demo UI: lets same-origin browsers call API-key-protected and
  // credential-minting routes without ever holding a key.
  app.post(
    "/api/v1/session",
    (ctx) => {
      ctx.setCookie("arag_session", app.issueSession(12 * 3600), { maxAge: 12 * 3600 });
      return { ok: true, expiresInSec: 12 * 3600 };
    },
    { operationId: "createSession", body: "none" },
  );

  // Static surfaces: UI kit, admin panel, demo console. Both UIs consume only /api/v1.
  app.static("/ui", resolve(HERE, "vendor/arag-platform/ui"), { cache: "public, max-age=300" });
  // Partner assets (a logo dropped into DATA_DIR/branding/) are served under /branding.
  app.static("/branding", resolve(env.dataDir, "branding"), { cache: "public, max-age=300" });
  app.static("/admin", resolve(HERE, "admin"));
  app.static("/", resolve(HERE, "public"));

  return {
    name: "voicebridge",
    version: VERSION,
    app,
    deps,
    async close() {
      listen.close();
      store.flushAll();
      await app.close();
      await mock?.close();
    },
  };
}

/** Re-exported so tests can assert job kinds without importing routes. */
export { GOLDEN_EVAL_JOB };
export type { Job };
export { notFound };
