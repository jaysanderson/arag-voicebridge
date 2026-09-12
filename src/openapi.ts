/**
 * OpenAPI 3.1 document for VoiceBridge — the single source of truth for the public API.
 *
 * Every `/api/v1` route is described here BEFORE it is implemented; `operationSchemas()` drives
 * request validation at runtime and the contract tests fail the build on drift.
 */
import {
  BrandingSchema,
  buildOpenApi,
  jsonBody,
  jsonResponse,
  standardResponses,
} from "../vendor/arag-platform/src/index.ts";

export const VERSION = "0.2.0";

const prospectKeyPattern = "^[a-z0-9][a-z0-9_-]{1,40}$";

const Citation = {
  type: "object",
  required: ["title", "url", "score"],
  properties: {
    title: { type: "string", description: "Source document title (shown as a chip, never spoken)" },
    url: { type: "string", description: "Source URL when the resource carries one" },
    score: { type: "number", description: "Best paragraph score for the source" },
  },
};

const LatencyMs = {
  type: "object",
  required: ["retrieve", "first_token", "total"],
  properties: {
    retrieve: { type: "integer", description: "ms until ARAG returned retrieval results" },
    first_token: { type: "integer", description: "ms until the first answer token" },
    total: { type: "integer", description: "ms for the whole turn, end to end" },
  },
};

const HistoryTurn = {
  type: "object",
  required: ["author", "text"],
  properties: {
    author: { type: "string", enum: ["USER", "NUCLIA"] },
    text: { type: "string", maxLength: 4000 },
  },
  additionalProperties: false,
};

const VoiceAnswerRequest = {
  type: "object",
  required: ["prospect", "question"],
  properties: {
    prospect: { type: "string", pattern: prospectKeyPattern, description: "Registry key" },
    question: { type: "string", minLength: 1, maxLength: 1200, description: "The caller's question" },
    conversation_id: { type: "string", maxLength: 120 },
    history: { type: "array", maxItems: 40, items: { $ref: "#/components/schemas/HistoryTurn" } },
    generative_model: { type: "string", maxLength: 120, description: "Per-request model override" },
  },
  additionalProperties: false,
};

const VoiceAnswerResponse = {
  type: "object",
  required: ["answer", "citations", "handoff", "latency_ms"],
  properties: {
    answer: { type: "string", description: "The spoken line — voice-shaped, ≤3 sentences, no markup" },
    citations: { type: "array", items: { $ref: "#/components/schemas/Citation" } },
    handoff: { type: "boolean", description: "True when the turn must escalate to a human" },
    latency_ms: { $ref: "#/components/schemas/LatencyMs" },
    handoff_reason: {
      type: "string",
      description: "Why the turn handed off or deflected (never spoken)",
      enum: [
        "sentinel",
        "not-found-phrase",
        "empty-answer",
        "no-retrieval",
        "upstream-error",
        "empty-question",
        "question-too-long",
        "prompt-injection",
        "unsafe-request",
        "empty-output",
        "unspeakable-content",
      ],
    },
  },
};

const BriefRequest = {
  type: "object",
  required: ["prospect", "text"],
  properties: {
    prospect: { type: "string", pattern: prospectKeyPattern },
    text: { type: "string", minLength: 1, maxLength: 1200, description: "Most recent words heard" },
    transcript: { type: "string", maxLength: 20000, description: "Conversation so far (most recent last)" },
    prev: {
      type: "object",
      additionalProperties: true,
      description: "Previous brief, to refine not restart",
    },
    generative_model: { type: "string", maxLength: 120 },
  },
  additionalProperties: false,
};

const BriefResponse = {
  type: "object",
  required: ["brief", "citations", "latency_ms"],
  properties: {
    brief: {
      description: "The structured brief (null when nothing relevant was found in time)",
      type: ["object", "null"],
      additionalProperties: true,
      properties: {
        topic: { type: "string" },
        caller_profile: { type: "string" },
        their_goal: { type: "string" },
        stage: { type: "string" },
        summary: { type: "string" },
        key_points: { type: "array", items: { type: "string" } },
        suggested_questions: { type: "array", items: { type: "string" } },
        suggested_answers: { type: "array", items: { type: "string" } },
        recommended_products: { type: "array", items: { type: "string" } },
      },
    },
    citations: { type: "array", items: { $ref: "#/components/schemas/Citation" } },
    latency_ms: { $ref: "#/components/schemas/LatencyMs" },
  },
};

const TranscriptEntry = {
  type: "object",
  required: ["speaker", "text", "ts", "final"],
  properties: {
    speaker: { type: "string", description: "Free-form label: caller, agent, a diarisation id…" },
    text: { type: "string" },
    ts: { type: "string", format: "date-time" },
    final: { type: "boolean", description: "False for interim STT hypotheses" },
  },
};

const TranscriptChunk = {
  type: "object",
  required: ["text"],
  properties: {
    speaker: { type: "string", maxLength: 40, default: "caller" },
    text: { type: "string", minLength: 1, maxLength: 4000 },
    ts: { type: "string", format: "date-time" },
    final: { type: "boolean", default: true, description: "Set false for an interim hypothesis" },
  },
  additionalProperties: false,
};

const ListenStats = {
  type: "object",
  required: ["chunks", "words", "refreshes", "skipped", "failures"],
  properties: {
    chunks: { type: "integer" },
    words: { type: "integer" },
    refreshes: { type: "integer", description: "Brief refreshes that produced something usable" },
    skipped: { type: "integer", description: "Refreshes the throttle deliberately skipped" },
    failures: { type: "integer" },
    lastLatencyMs: { type: "integer" },
    p50LatencyMs: { type: "integer" },
    p95LatencyMs: { type: "integer" },
  },
};

const ListenSession = {
  type: "object",
  required: ["id", "prospect", "status", "brief", "briefVersion", "citations", "stats"],
  properties: {
    id: { type: "string" },
    createdAt: { type: "string", format: "date-time" },
    updatedAt: { type: "string", format: "date-time" },
    prospect: { type: "string" },
    locale: { type: "string" },
    generative_model: { type: "string" },
    metadata: { type: "object", additionalProperties: true },
    status: { type: "string", enum: ["live", "ended"] },
    endedAt: { type: "string", format: "date-time" },
    brief: {
      type: ["object", "null"],
      additionalProperties: true,
      description: "The evolving brief — same shape as POST /api/v1/brief returns",
    },
    briefVersion: { type: "integer", description: "Increments on every usable refresh" },
    citations: { type: "array", items: { $ref: "#/components/schemas/Citation" } },
    stats: { $ref: "#/components/schemas/ListenStats" },
    transcript: { type: "array", items: { $ref: "#/components/schemas/TranscriptEntry" } },
    transcriptTotal: { type: "integer" },
  },
};

const GoldenQuestion = {
  type: "object",
  required: ["q", "expect"],
  properties: {
    q: { type: "string", minLength: 1, maxLength: 500 },
    expect: { type: "string", enum: ["answer", "handoff"] },
    must_include: { type: "array", items: { type: "string" } },
  },
  additionalProperties: false,
};

const Prospect = {
  type: "object",
  description: "Non-secret projection of a registry entry (safe for browsers)",
  required: ["key", "display_name", "locale", "greeting", "handoff_msg"],
  properties: {
    key: { type: "string" },
    display_name: { type: "string" },
    locale: { type: "string" },
    greeting: { type: "string" },
    handoff_msg: { type: "string" },
    agent_id: { type: ["string", "null"], description: "ElevenLabs agent id (non-secret)" },
    voice_id: { type: ["string", "null"] },
    golden_questions: { type: "array", items: { $ref: "#/components/schemas/GoldenQuestion" } },
    avatar_ready: { type: "boolean" },
    scribe_ready: { type: "boolean" },
    brand: {
      $ref: "#/components/schemas/Branding",
      description: "Deployment branding with this prospect's overrides applied",
    },
  },
};

const ProspectInput = {
  type: "object",
  description: "Full prospect configuration (admin only — contains KB ids)",
  required: ["display_name", "kb_id", "region", "locale", "greeting", "handoff_msg"],
  properties: {
    display_name: { type: "string", minLength: 1, maxLength: 120 },
    kb_id: { type: "string", minLength: 1, maxLength: 80, description: "ARAG Knowledge Box id" },
    region: { type: "string", minLength: 1, maxLength: 60, description: "ARAG zone slug" },
    ask_config: { type: "string", maxLength: 120, description: "Stored ask search configuration name" },
    reranker: { type: "string", enum: ["noop", "predict"] },
    max_tokens: { type: "integer", minimum: 16, maximum: 4000 },
    generative_model: { type: "string", maxLength: 120 },
    temperature: { type: "number", minimum: 0, maximum: 2 },
    brief_model: { type: "string", maxLength: 120 },
    brand: {
      type: "object",
      description: "White-label overrides for this prospect, layered on the deployment's branding",
      properties: {
        productName: { type: "string", maxLength: 120 },
        tagline: { type: "string", maxLength: 200 },
        logoUrl: { type: "string", maxLength: 500 },
        primaryColor: { type: "string", maxLength: 40 },
        accentColor: { type: "string", maxLength: 40 },
        footerText: { type: "string", maxLength: 200 },
        poweredBy: { type: "boolean" },
      },
      additionalProperties: false,
    },
    agent_id: { type: "string", maxLength: 120 },
    voice_id: { type: "string", maxLength: 120 },
    avatar_id: { type: "string", maxLength: 120 },
    locale: { type: "string", minLength: 2, maxLength: 20 },
    greeting: { type: "string", minLength: 1, maxLength: 600 },
    handoff_msg: { type: "string", minLength: 1, maxLength: 600 },
    golden_questions: {
      type: "array",
      maxItems: 100,
      items: { $ref: "#/components/schemas/GoldenQuestion" },
    },
  },
  additionalProperties: false,
};

// A stored entry is the input shape plus the store's identity/timestamps. It is spelled out
// rather than composed with allOf because `additionalProperties: false` on the input would
// otherwise reject those fields.
const ProspectRecord = {
  type: "object",
  description: "A stored registry entry (admin only)",
  required: ["id", "display_name", "kb_id", "region", "locale", "greeting", "handoff_msg"],
  properties: {
    id: { type: "string", description: "Registry key" },
    createdAt: { type: "string", format: "date-time" },
    updatedAt: { type: "string", format: "date-time" },
    ...ProspectInput.properties,
  },
  additionalProperties: false,
};

const ProspectCreate = {
  type: "object",
  required: ["key", "config"],
  properties: {
    key: { type: "string", pattern: prospectKeyPattern },
    config: { $ref: "#/components/schemas/ProspectInput" },
  },
  additionalProperties: false,
};

const ModelOption = {
  type: "object",
  required: ["id", "label", "speed", "quality", "price"],
  properties: {
    id: { type: "string" },
    label: { type: "string" },
    speed: { type: "integer", minimum: 1, maximum: 3 },
    quality: { type: "integer", minimum: 1, maximum: 3 },
    price: { type: "integer", minimum: 1, maximum: 3 },
  },
};

const Metrics = {
  type: "object",
  required: ["turns", "latency_total_ms", "latency_first_token_ms", "handoff_rate"],
  properties: {
    turns: { type: "integer" },
    latency_total_ms: {
      type: "object",
      properties: { p50: { type: "integer" }, p95: { type: "integer" } },
    },
    latency_first_token_ms: {
      type: "object",
      properties: { p50: { type: "integer" }, p95: { type: "integer" } },
    },
    handoff_rate: { type: "number" },
    citation_coverage: { type: "number" },
    guard_trip_rate: { type: "number" },
    by_prospect: { type: "object", additionalProperties: { type: "integer" } },
  },
};

const TurnRecord = {
  type: "object",
  required: ["id", "prospect", "total", "handoff", "createdAt"],
  properties: {
    id: { type: "string" },
    createdAt: { type: "string", format: "date-time" },
    prospect: { type: "string" },
    conversation_id: { type: "string" },
    question: { type: "string", description: "Omitted when a safety guard tripped" },
    total: { type: "integer" },
    first_token: { type: "integer" },
    retrieve: { type: "integer" },
    citations: { type: "integer" },
    handoff: { type: "boolean" },
    guard_trip: { type: "boolean" },
    reason: { type: "string" },
    source: { type: "string", enum: ["voice-answer", "golden-eval"] },
  },
};

const GoldenCase = {
  type: "object",
  required: ["q", "expect", "answer", "handoff", "passed", "checks"],
  properties: {
    q: { type: "string" },
    expect: { type: "string", enum: ["answer", "handoff"] },
    answer: { type: "string" },
    handoff: { type: "boolean" },
    handoff_reason: { type: "string" },
    citations: { type: "integer" },
    latency_ms: { type: "integer" },
    passed: { type: "boolean" },
    checks: {
      type: "array",
      items: {
        type: "object",
        required: ["ok", "label"],
        properties: { ok: { type: "boolean" }, label: { type: "string" } },
      },
    },
  },
};

const GoldenEval = {
  type: "object",
  required: ["id", "prospect", "ok", "total", "passed", "failed", "cases"],
  properties: {
    id: { type: "string" },
    createdAt: { type: "string", format: "date-time" },
    prospect: { type: "string" },
    display_name: { type: "string" },
    ok: { type: "boolean" },
    total: { type: "integer" },
    passed: { type: "integer" },
    failed: { type: "integer" },
    latency_ms: { type: "object", properties: { p50: { type: "integer" }, p95: { type: "integer" } } },
    cases: { type: "array", items: { $ref: "#/components/schemas/GoldenCase" } },
    startedAt: { type: "string", format: "date-time" },
    finishedAt: { type: "string", format: "date-time" },
  },
};

const pathKey = {
  name: "key",
  in: "path",
  required: true,
  schema: { type: "string", pattern: prospectKeyPattern },
};
const pathId = { name: "id", in: "path", required: true, schema: { type: "string", maxLength: 80 } };

const publicSecurity = [{ ApiKey: [] }, { Bearer: [] }];
const adminSecurity = [{ AdminToken: [] }];

/** POST /api/v1/voice-answer and its /v1/voice-answer compatibility alias share this operation. */
function voiceAnswerOp(operationId: string, summary: string, description: string) {
  return {
    operationId,
    tags: ["voice"],
    summary,
    description,
    requestBody: jsonBody({ $ref: "#/components/schemas/VoiceAnswerRequest" }),
    responses: {
      200: jsonResponse({ $ref: "#/components/schemas/VoiceAnswerResponse" }, "The spoken turn"),
      ...standardResponses,
    },
    security: publicSecurity,
  };
}

export const openapi = buildOpenApi({
  info: {
    title: "VoiceBridge API",
    version: VERSION,
    description:
      "Grounded, cited and governed voice answers over Progress Agentic RAG (ARAG).\n\n" +
      "`POST /api/v1/voice-answer` is the endpoint a voice agent's custom tool calls: it runs the " +
      "nine-step turn pipeline (safety guards → ARAG ask → deterministic handoff → voice shaping → " +
      "citations) and always returns something speakable within the agent's tool timeout.\n\n" +
      "`POST /api/v1/brief` powers the ambient copilot: a structured, evolving brief built with " +
      "ARAG's `answer_json_schema`.\n\n" +
      "Authentication: public routes are open unless `API_KEYS` is set (then `X-API-Key` or a " +
      "same-origin session from `POST /api/v1/session`); `/api/v1/admin/*` always requires " +
      "`ADMIN_TOKEN`.",
  },
  tags: [
    {
      name: "listen",
      description:
        "Real-time listening: ingest a conversation from any source and stream back an evolving, " +
        "grounded brief",
    },
    { name: "voice", description: "Voice turns and the live brief" },
    { name: "prospects", description: "The prospect registry (non-secret projection)" },
    { name: "realtime", description: "ElevenLabs Scribe and LiveAvatar session bootstrap" },
    { name: "quality", description: "Metrics and golden-set evaluations" },
    { name: "jobs", description: "Asynchronous work" },
    { name: "admin", description: "Operator endpoints (ADMIN_TOKEN)" },
    { name: "system", description: "Health and session" },
  ],
  schemas: {
    Branding: BrandingSchema,
    Citation,
    TranscriptEntry,
    TranscriptChunk,
    ListenStats,
    ListenSession,
    LatencyMs,
    HistoryTurn,
    VoiceAnswerRequest,
    VoiceAnswerResponse,
    BriefRequest,
    BriefResponse,
    GoldenQuestion,
    Prospect,
    ProspectInput,
    ProspectRecord,
    ProspectCreate,
    ModelOption,
    Metrics,
    TurnRecord,
    GoldenCase,
    GoldenEval,
  },
  paths: {
    "/api/v1/listen/sessions": {
      post: {
        operationId: "createListenSession",
        tags: ["listen"],
        summary: "Start a listen session",
        description:
          "Opens a session for a prospect. Feed it conversation with " +
          "`POST /api/v1/listen/sessions/{id}/transcript` from any source — a realtime STT stream, " +
          "a telephony webhook, a meeting bot, or someone typing — and read the evolving brief " +
          "from the SSE stream or by polling the session.",
        requestBody: jsonBody({
          type: "object",
          required: ["prospect"],
          properties: {
            prospect: { type: "string", pattern: prospectKeyPattern },
            locale: { type: "string", maxLength: 20 },
            generative_model: { type: "string", maxLength: 120 },
            metadata: {
              type: "object",
              additionalProperties: true,
              description: "Opaque caller context (agent id, queue, call id…) kept with the session",
            },
          },
          additionalProperties: false,
        }),
        responses: {
          201: jsonResponse({ $ref: "#/components/schemas/ListenSession" }, "Session started"),
          ...standardResponses,
        },
        security: publicSecurity,
      },
      get: {
        operationId: "listListenSessions",
        tags: ["listen"],
        summary: "Recent listen sessions",
        parameters: [
          { name: "prospect", in: "query", schema: { type: "string", pattern: prospectKeyPattern } },
          { name: "limit", in: "query", schema: { type: "integer", minimum: 1, maximum: 100, default: 25 } },
        ],
        responses: {
          200: jsonResponse({
            type: "object",
            required: ["items"],
            properties: { items: { type: "array", items: { $ref: "#/components/schemas/ListenSession" } } },
          }),
          ...standardResponses,
        },
        security: publicSecurity,
      },
    },
    "/api/v1/listen/sessions/{id}": {
      parameters: [pathId],
      get: {
        operationId: "getListenSession",
        tags: ["listen"],
        summary: "Session state: brief, citations, stats and a transcript tail",
        parameters: [
          {
            name: "transcript_tail",
            in: "query",
            schema: { type: "integer", minimum: 0, maximum: 400, default: 50 },
          },
        ],
        responses: {
          200: jsonResponse({ $ref: "#/components/schemas/ListenSession" }),
          ...standardResponses,
        },
        security: publicSecurity,
      },
      delete: {
        operationId: "endListenSession",
        tags: ["listen"],
        summary: "End a session (the brief, citations and stats are kept)",
        responses: {
          200: jsonResponse({ $ref: "#/components/schemas/ListenSession" }, "Session ended"),
          ...standardResponses,
        },
        security: publicSecurity,
      },
    },
    "/api/v1/listen/sessions/{id}/transcript": {
      parameters: [pathId],
      post: {
        operationId: "appendListenTranscript",
        tags: ["listen"],
        summary: "Append conversation to a session",
        description:
          "Accepts final or interim chunks from any transcription source. The server throttles and " +
          "de-duplicates refreshes (a rolling window of the last words, a minimum gap, and a " +
          "similarity check), so a chatty client cannot turn every word into an LLM call. The " +
          "response says what the throttle decided.",
        requestBody: jsonBody({
          type: "object",
          required: ["chunks"],
          properties: {
            chunks: {
              type: "array",
              minItems: 1,
              maxItems: 50,
              items: { $ref: "#/components/schemas/TranscriptChunk" },
            },
          },
          additionalProperties: false,
        }),
        responses: {
          202: jsonResponse(
            {
              type: "object",
              required: ["session", "refresh"],
              properties: {
                session: { $ref: "#/components/schemas/ListenSession" },
                refresh: {
                  type: "string",
                  enum: ["started", "scheduled", "skipped"],
                  description: "What the throttle did with this append",
                },
                reason: {
                  type: "string",
                  enum: ["ok", "too-few-words", "too-soon", "unchanged", "too-similar"],
                },
              },
            },
            "Accepted",
          ),
          409: {
            description: "The session has ended",
            content: { "application/problem+json": { schema: { $ref: "#/components/schemas/Problem" } } },
          },
          ...standardResponses,
        },
        security: publicSecurity,
      },
    },
    "/api/v1/listen/sessions/{id}/events": {
      parameters: [pathId],
      get: {
        operationId: "listenSessionEvents",
        tags: ["listen"],
        summary: "Server-sent events for a session (event: brief | transcript | status)",
        responses: {
          200: {
            description: "text/event-stream",
            content: { "text/event-stream": { schema: { type: "string" } } },
          },
          ...standardResponses,
        },
        security: publicSecurity,
      },
    },
    "/api/v1/voice-answer": {
      post: voiceAnswerOp(
        "voiceAnswer",
        "Answer one voice turn",
        "Runs the turn pipeline for a prospect and returns a spoken answer, citations and a " +
          "handoff flag. Never throws at the caller: upstream failures degrade to the prospect's " +
          "handoff line so the agent never gets dead air.",
      ),
    },
    "/v1/voice-answer": {
      post: voiceAnswerOp(
        "voiceAnswerLegacy",
        "Answer one voice turn (compatibility alias)",
        "Identical to `POST /api/v1/voice-answer`. Kept so ElevenLabs agents configured against " +
          "the original bridge URL keep working; new integrations should use the versioned path.",
      ),
    },
    "/api/v1/brief": {
      post: {
        operationId: "brief",
        tags: ["voice"],
        summary: "Refresh the structured live brief",
        description:
          "Listen mode: given the most recent words heard, the running transcript and the previous " +
          "brief, returns an updated structured brief grounded in the Knowledge Box. Rate-limited " +
          "more strictly than /voice-answer because it fires continuously while listening.",
        requestBody: jsonBody({ $ref: "#/components/schemas/BriefRequest" }),
        responses: {
          200: jsonResponse({ $ref: "#/components/schemas/BriefResponse" }),
          ...standardResponses,
        },
        security: publicSecurity,
      },
    },
    "/api/v1/prospects": {
      get: {
        operationId: "listProspects",
        tags: ["prospects"],
        summary: "List prospects (non-secret projection)",
        responses: {
          200: jsonResponse({
            type: "object",
            required: ["items"],
            properties: { items: { type: "array", items: { $ref: "#/components/schemas/Prospect" } } },
          }),
          ...standardResponses,
        },
        security: publicSecurity,
      },
    },
    "/api/v1/prospects/{key}": {
      parameters: [pathKey],
      get: {
        operationId: "getProspect",
        tags: ["prospects"],
        summary: "Get one prospect (non-secret projection)",
        responses: { 200: jsonResponse({ $ref: "#/components/schemas/Prospect" }), ...standardResponses },
        security: publicSecurity,
      },
    },
    "/api/v1/models": {
      get: {
        operationId: "listModels",
        tags: ["prospects"],
        summary: "Generative models available for a prospect's Knowledge Box",
        parameters: [
          {
            name: "prospect",
            in: "query",
            required: true,
            schema: { type: "string", pattern: prospectKeyPattern },
          },
        ],
        responses: {
          200: jsonResponse({
            type: "object",
            required: ["models"],
            properties: {
              models: { type: "array", items: { $ref: "#/components/schemas/ModelOption" } },
              current: { type: ["string", "null"], description: "The KB's configured default model" },
            },
          }),
          ...standardResponses,
        },
        security: publicSecurity,
      },
    },
    "/api/v1/voices": {
      get: {
        operationId: "listVoices",
        tags: ["prospects"],
        summary: "ElevenLabs voices available to the deployment",
        description: "503 when `ELEVENLABS_API_KEY` is not configured; the demo then uses the agent default.",
        responses: {
          200: jsonResponse({
            type: "object",
            required: ["voices"],
            properties: {
              voices: {
                type: "array",
                items: {
                  type: "object",
                  required: ["id", "name"],
                  properties: {
                    id: { type: "string" },
                    name: { type: "string" },
                    category: { type: "string" },
                  },
                },
              },
            },
          }),
          503: {
            description: "ElevenLabs is not configured",
            content: { "application/problem+json": { schema: { $ref: "#/components/schemas/Problem" } } },
          },
          ...standardResponses,
        },
        security: publicSecurity,
      },
    },
    "/api/v1/scribe-token": {
      post: {
        operationId: "createScribeToken",
        tags: ["realtime"],
        summary: "Mint a single-use ElevenLabs Scribe realtime token",
        description:
          "Requires a same-origin session (`POST /api/v1/session`), an API key or the admin token, " +
          "and is rate-limited separately: the token spends ElevenLabs quota. The browser never " +
          "holds the ElevenLabs API key.",
        responses: {
          200: jsonResponse({
            type: "object",
            required: ["token"],
            properties: { token: { type: "string" }, expiresInSec: { type: "integer" } },
          }),
          503: {
            description: "ElevenLabs is not configured",
            content: { "application/problem+json": { schema: { $ref: "#/components/schemas/Problem" } } },
          },
          ...standardResponses,
        },
        security: publicSecurity,
      },
    },
    "/api/v1/avatar/sessions": {
      post: {
        operationId: "createAvatarSession",
        tags: ["realtime"],
        summary: "Start a LiveAvatar session in a bridge-owned LiveKit room",
        requestBody: jsonBody({
          type: "object",
          required: ["prospect"],
          properties: { prospect: { type: "string", pattern: prospectKeyPattern } },
          additionalProperties: false,
        }),
        responses: {
          201: jsonResponse(
            {
              type: "object",
              required: ["livekit_url", "room", "token"],
              properties: {
                livekit_url: { type: "string" },
                room: { type: "string" },
                token: { type: "string", description: "Viewer token for the browser" },
                session_id: { type: ["string", "null"] },
              },
            },
            "Session started",
          ),
          503: {
            description: "LiveAvatar/LiveKit are not configured",
            content: { "application/problem+json": { schema: { $ref: "#/components/schemas/Problem" } } },
          },
          ...standardResponses,
        },
        security: publicSecurity,
      },
    },
    "/api/v1/metrics": {
      get: {
        operationId: "getMetrics",
        tags: ["quality"],
        summary: "Turn metrics over the recent window",
        parameters: [
          { name: "prospect", in: "query", schema: { type: "string", pattern: prospectKeyPattern } },
        ],
        responses: { 200: jsonResponse({ $ref: "#/components/schemas/Metrics" }), ...standardResponses },
        security: publicSecurity,
      },
    },
    "/api/v1/golden-evals": {
      post: {
        operationId: "createGoldenEval",
        tags: ["quality"],
        summary: "Run a prospect's golden set (async job)",
        description:
          "Runs every golden question through the in-process pipeline and stores the result. " +
          "Returns 202 with a job; poll `/api/v1/jobs/{id}` or stream `/api/v1/jobs/{id}/events`.",
        requestBody: jsonBody({
          type: "object",
          required: ["prospect"],
          properties: { prospect: { type: "string", pattern: prospectKeyPattern } },
          additionalProperties: false,
        }),
        responses: {
          202: jsonResponse(
            {
              type: "object",
              required: ["job"],
              properties: { job: { $ref: "#/components/schemas/Job" } },
            },
            "Accepted",
          ),
          ...standardResponses,
        },
        security: publicSecurity,
      },
    },
    "/api/v1/golden-evals/{id}": {
      parameters: [pathId],
      get: {
        operationId: "getGoldenEval",
        tags: ["quality"],
        summary: "Get a golden-set result",
        description: "The id is either the evaluation id or the id of the job that produced it.",
        responses: { 200: jsonResponse({ $ref: "#/components/schemas/GoldenEval" }), ...standardResponses },
        security: publicSecurity,
      },
    },
    "/api/v1/jobs": {
      get: {
        operationId: "listJobs",
        tags: ["jobs"],
        summary: "List jobs",
        parameters: [
          {
            name: "status",
            in: "query",
            schema: { type: "string", enum: ["queued", "running", "succeeded", "failed", "cancelled"] },
          },
          { name: "limit", in: "query", schema: { type: "integer", minimum: 1, maximum: 200, default: 50 } },
        ],
        responses: {
          200: jsonResponse({
            type: "object",
            properties: { items: { type: "array", items: { $ref: "#/components/schemas/Job" } } },
          }),
          ...standardResponses,
        },
        security: publicSecurity,
      },
    },
    "/api/v1/jobs/{id}": {
      parameters: [pathId],
      get: {
        operationId: "getJob",
        tags: ["jobs"],
        summary: "Get a job",
        responses: { 200: jsonResponse({ $ref: "#/components/schemas/Job" }), ...standardResponses },
        security: publicSecurity,
      },
      delete: {
        operationId: "cancelJob",
        tags: ["jobs"],
        summary: "Cancel a job",
        responses: { 204: { description: "Cancelled" }, ...standardResponses },
        security: publicSecurity,
      },
    },
    "/api/v1/jobs/{id}/events": {
      parameters: [pathId],
      get: {
        operationId: "jobEvents",
        tags: ["jobs"],
        summary: "Server-sent events for a job (event: event|job)",
        responses: {
          200: {
            description: "text/event-stream",
            content: { "text/event-stream": { schema: { type: "string" } } },
          },
          ...standardResponses,
        },
        security: publicSecurity,
      },
    },
    "/api/v1/branding": {
      get: {
        operationId: "getBranding",
        tags: ["system"],
        summary: "White-label branding for this deployment",
        description:
          "Public: the console and the admin panel apply it at boot (name, logo, colours, footer, " +
          "and whether the Progress credit is shown). Partners set `BRAND_*` in the environment; " +
          "per-prospect overrides are returned with each prospect.",
        responses: {
          200: jsonResponse({ $ref: "#/components/schemas/Branding" }),
          ...standardResponses,
        },
      },
    },
    "/api/v1/session": {
      post: {
        operationId: "createSession",
        tags: ["system"],
        summary: "Issue a same-origin session cookie for the demo UI",
        responses: {
          200: jsonResponse({
            type: "object",
            properties: { ok: { type: "boolean" }, expiresInSec: { type: "integer" } },
          }),
          ...standardResponses,
        },
      },
    },
    "/api/v1/admin/login": {
      post: {
        operationId: "adminLogin",
        tags: ["admin"],
        summary: "Exchange the admin token for an HttpOnly cookie",
        requestBody: jsonBody({
          type: "object",
          required: ["token"],
          properties: { token: { type: "string", maxLength: 500 } },
          additionalProperties: false,
        }),
        responses: {
          200: jsonResponse({ type: "object", properties: { ok: { type: "boolean" } } }),
          ...standardResponses,
        },
      },
    },
    "/api/v1/admin/health": {
      get: {
        operationId: "adminHealth",
        tags: ["admin"],
        summary: "Service health plus a per-prospect Knowledge Box connection test",
        parameters: [
          { name: "prospect", in: "query", schema: { type: "string", pattern: prospectKeyPattern } },
        ],
        responses: {
          200: jsonResponse({
            type: "object",
            required: ["ok", "prospects"],
            properties: {
              ok: { type: "boolean" },
              version: { type: "string" },
              uptimeSec: { type: "number" },
              mock: { type: "boolean" },
              prospects: {
                type: "array",
                items: {
                  type: "object",
                  required: ["key", "ok"],
                  properties: {
                    key: { type: "string" },
                    display_name: { type: "string" },
                    ok: { type: "boolean" },
                    kbId: { type: "string" },
                    baseUrl: { type: "string" },
                    resources: { type: "integer" },
                    generativeModel: { type: "string" },
                    ms: { type: "integer" },
                    error: { type: "string" },
                  },
                },
              },
            },
          }),
          ...standardResponses,
        },
        security: adminSecurity,
      },
    },
    "/api/v1/admin/config": {
      get: {
        operationId: "adminConfig",
        tags: ["admin"],
        summary: "Effective configuration (secrets redacted)",
        responses: {
          200: jsonResponse({ type: "object", additionalProperties: true }),
          ...standardResponses,
        },
        security: adminSecurity,
      },
    },
    "/api/v1/admin/usage": {
      get: {
        operationId: "adminUsage",
        tags: ["admin"],
        summary: "Usage counters (requests, ARAG calls, jobs, turns)",
        responses: {
          200: jsonResponse({ type: "object", additionalProperties: true }),
          ...standardResponses,
        },
        security: adminSecurity,
      },
    },
    "/api/v1/admin/logs": {
      get: {
        operationId: "adminLogs",
        tags: ["admin"],
        summary: "Recent log records",
        parameters: [
          {
            name: "level",
            in: "query",
            schema: { type: "string", enum: ["debug", "info", "warn", "error"] },
          },
          { name: "contains", in: "query", schema: { type: "string", maxLength: 200 } },
          { name: "limit", in: "query", schema: { type: "integer", minimum: 1, maximum: 500, default: 200 } },
        ],
        responses: {
          200: jsonResponse({
            type: "object",
            properties: { items: { type: "array", items: { $ref: "#/components/schemas/LogRecord" } } },
          }),
          ...standardResponses,
        },
        security: adminSecurity,
      },
    },
    "/api/v1/admin/prospects": {
      get: {
        operationId: "adminListProspects",
        tags: ["admin"],
        summary: "List registry entries in full",
        responses: {
          200: jsonResponse({
            type: "object",
            required: ["items"],
            properties: { items: { type: "array", items: { $ref: "#/components/schemas/ProspectRecord" } } },
          }),
          ...standardResponses,
        },
        security: adminSecurity,
      },
      post: {
        operationId: "adminCreateProspect",
        tags: ["admin"],
        summary: "Create a prospect",
        requestBody: jsonBody({ $ref: "#/components/schemas/ProspectCreate" }),
        responses: {
          201: jsonResponse({ $ref: "#/components/schemas/ProspectRecord" }, "Created"),
          409: {
            description: "Key already exists",
            content: { "application/problem+json": { schema: { $ref: "#/components/schemas/Problem" } } },
          },
          ...standardResponses,
        },
        security: adminSecurity,
      },
    },
    "/api/v1/admin/prospects/{key}": {
      parameters: [pathKey],
      get: {
        operationId: "adminGetProspect",
        tags: ["admin"],
        summary: "Get a registry entry in full",
        responses: {
          200: jsonResponse({ $ref: "#/components/schemas/ProspectRecord" }),
          ...standardResponses,
        },
        security: adminSecurity,
      },
      put: {
        operationId: "adminReplaceProspect",
        tags: ["admin"],
        summary: "Replace a registry entry",
        requestBody: jsonBody({ $ref: "#/components/schemas/ProspectInput" }),
        responses: {
          200: jsonResponse({ $ref: "#/components/schemas/ProspectRecord" }),
          ...standardResponses,
        },
        security: adminSecurity,
      },
      delete: {
        operationId: "adminDeleteProspect",
        tags: ["admin"],
        summary: "Delete a registry entry",
        responses: { 204: { description: "Deleted" }, ...standardResponses },
        security: adminSecurity,
      },
    },
    "/api/v1/admin/prospects/{key}/provision": {
      parameters: [pathKey],
      post: {
        operationId: "adminProvisionProspect",
        tags: ["admin"],
        summary: "Create or update the prospect's stored ARAG search configuration",
        description:
          "Idempotent. Writes the voice prompt, retrieval governance and latency levers into the " +
          "Knowledge Box as a stored `ask` search configuration, then points the registry entry at it.",
        requestBody: jsonBody(
          {
            type: "object",
            properties: {
              name: { type: "string", maxLength: 120 },
              reranker: { type: "string", enum: ["noop", "predict"] },
              generative_model: { type: "string", maxLength: 120 },
              dry_run: { type: "boolean", default: false },
            },
            additionalProperties: false,
          },
          false,
        ),
        responses: {
          200: jsonResponse({
            type: "object",
            required: ["name", "applied"],
            properties: {
              name: { type: "string" },
              applied: { type: "boolean" },
              config: { type: "object", additionalProperties: true },
              prospect: { $ref: "#/components/schemas/ProspectRecord" },
            },
          }),
          ...standardResponses,
        },
        security: adminSecurity,
      },
    },
    "/api/v1/admin/turns": {
      get: {
        operationId: "adminTurns",
        tags: ["admin"],
        summary: "Recent turn log (latency, handoff reason, guard trips)",
        description: "The question text is omitted for turns where a safety guard tripped.",
        parameters: [
          { name: "prospect", in: "query", schema: { type: "string", pattern: prospectKeyPattern } },
          { name: "limit", in: "query", schema: { type: "integer", minimum: 1, maximum: 500, default: 100 } },
        ],
        responses: {
          200: jsonResponse({
            type: "object",
            required: ["items"],
            properties: { items: { type: "array", items: { $ref: "#/components/schemas/TurnRecord" } } },
          }),
          ...standardResponses,
        },
        security: adminSecurity,
      },
    },
    "/api/v1/admin/listen-sessions": {
      get: {
        operationId: "adminListenSessions",
        tags: ["admin"],
        summary: "Recent listen sessions with brief history and latency",
        parameters: [
          { name: "prospect", in: "query", schema: { type: "string", pattern: prospectKeyPattern } },
          { name: "limit", in: "query", schema: { type: "integer", minimum: 1, maximum: 100, default: 25 } },
        ],
        responses: {
          200: jsonResponse({
            type: "object",
            required: ["items"],
            properties: {
              items: {
                type: "array",
                items: {
                  allOf: [
                    { $ref: "#/components/schemas/ListenSession" },
                    {
                      type: "object",
                      properties: {
                        briefHistory: {
                          type: "array",
                          items: {
                            type: "object",
                            properties: {
                              version: { type: "integer" },
                              at: { type: "string", format: "date-time" },
                              latencyMs: { type: "integer" },
                              brief: { type: "object", additionalProperties: true },
                            },
                          },
                        },
                      },
                    },
                  ],
                },
              },
            },
          }),
          ...standardResponses,
        },
        security: adminSecurity,
      },
    },
    "/api/v1/admin/golden-evals": {
      get: {
        operationId: "adminGoldenEvals",
        tags: ["admin"],
        summary: "Golden-set evaluation history",
        parameters: [
          { name: "prospect", in: "query", schema: { type: "string", pattern: prospectKeyPattern } },
          { name: "limit", in: "query", schema: { type: "integer", minimum: 1, maximum: 100, default: 25 } },
        ],
        responses: {
          200: jsonResponse({
            type: "object",
            required: ["items"],
            properties: { items: { type: "array", items: { $ref: "#/components/schemas/GoldenEval" } } },
          }),
          ...standardResponses,
        },
        security: adminSecurity,
      },
    },
  },
});
