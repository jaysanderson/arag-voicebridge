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
    trace: {
      type: "boolean",
      description:
        "Return the per-step pipeline trace alongside the answer. The Ask tester sets this; a " +
        "voice agent never should (it adds bytes to every turn).",
    },
  },
  additionalProperties: false,
};

const PipelineStep = {
  type: "object",
  description: "One step of the nine-step turn pipeline, as run for this question",
  required: ["step", "id", "label", "status", "ms"],
  properties: {
    step: { type: "integer" },
    id: { type: "string", description: "Stable step id (resolve, guard-input, ask, handoff, …)" },
    label: { type: "string" },
    status: { type: "string", enum: ["ok", "skipped", "tripped", "handoff", "error"] },
    ms: { type: "integer", description: "ms from the start of the turn to the end of this step" },
    detail: { type: "string", description: "What happened, in one line" },
  },
};

const VoiceAnswerResponse = {
  type: "object",
  required: ["answer", "citations", "handoff", "latency_ms"],
  properties: {
    answer: { type: "string", description: "The spoken line — voice-shaped, ≤3 sentences, no markup" },
    citations: { type: "array", items: { $ref: "#/components/schemas/Citation" } },
    handoff: { type: "boolean", description: "True when the turn must escalate to a human" },
    latency_ms: { $ref: "#/components/schemas/LatencyMs" },
    pipeline: {
      type: "array",
      description: "Present only when the request asked to trace",
      items: { $ref: "#/components/schemas/PipelineStep" },
    },
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

const BriefSnapshot = {
  type: "object",
  required: ["version", "at", "brief"],
  properties: {
    version: { type: "integer" },
    at: { type: "string", format: "date-time" },
    brief: { type: ["object", "null"], additionalProperties: true },
    latencyMs: { type: "integer" },
  },
};

const ListenSessionExport = {
  type: "object",
  description: "The complete record of one call: every brief version, the whole transcript, sources",
  required: ["id", "prospect", "status", "brief", "briefHistory", "citations", "stats", "transcript"],
  properties: {
    id: { type: "string" },
    createdAt: { type: "string", format: "date-time" },
    updatedAt: { type: "string", format: "date-time" },
    endedAt: { type: "string", format: "date-time" },
    prospect: { type: "string" },
    locale: { type: "string" },
    generative_model: { type: "string" },
    metadata: { type: "object", additionalProperties: true },
    status: { type: "string", enum: ["live", "ended"] },
    durationSec: { type: "integer" },
    brief: { type: ["object", "null"], additionalProperties: true },
    briefVersion: { type: "integer" },
    briefHistory: { type: "array", items: { $ref: "#/components/schemas/BriefSnapshot" } },
    citations: { type: "array", items: { $ref: "#/components/schemas/Citation" } },
    stats: { $ref: "#/components/schemas/ListenStats" },
    transcript: { type: "array", items: { $ref: "#/components/schemas/TranscriptEntry" } },
  },
};

const KnowledgeStatus = {
  type: "object",
  description: "What the selected prospect is grounded in, and whether its golden gate is open",
  required: ["prospect", "display_name", "kb", "golden_questions"],
  properties: {
    prospect: { type: "string" },
    display_name: { type: "string" },
    kb: {
      type: "object",
      required: ["ok", "region"],
      properties: {
        ok: { type: "boolean" },
        id_masked: { type: "string", description: "Knowledge Box id, partially masked" },
        title: { type: "string" },
        region: { type: "string" },
        resources: { type: ["integer", "null"], description: "Resources in the Knowledge Box" },
        generative_model: { type: "string" },
        reranker: { type: "string" },
        provisioned: {
          type: "boolean",
          description: "True when a stored ask search configuration is in force (its name is admin-only)",
        },
        brief_model: { type: "string" },
        ms: { type: "integer" },
        mock: { type: "boolean", description: "True when the deployment runs against the mock ARAG" },
        error: { type: "string" },
      },
    },
    golden_questions: { type: "array", items: { $ref: "#/components/schemas/GoldenQuestion" } },
    last_eval: {
      description: "The most recent golden run for this prospect, or null when it has never run",
      oneOf: [{ $ref: "#/components/schemas/GoldenEvalSummary" }, { type: "null" }],
    },
  },
};

const IntegrationStatus = {
  type: "object",
  required: ["id", "name", "configured", "purpose"],
  properties: {
    id: { type: "string", enum: ["arag", "elevenlabs"] },
    name: { type: "string" },
    configured: { type: "boolean" },
    primary: {
      type: "boolean",
      description: "True for the integrations the out-of-the-box experience is built on",
    },
    purpose: { type: "string", description: "What this integration unlocks in the product" },
    detail: { type: "string", description: "Non-secret endpoint or mode, never a credential" },
    setup: { type: "string", description: "The environment variables that switch it on" },
    capabilities: {
      type: "array",
      description: "What this deployment actually uses the integration for",
      items: {
        type: "object",
        required: ["name", "detail", "enabled"],
        properties: {
          name: { type: "string" },
          detail: { type: "string" },
          enabled: { type: "boolean" },
        },
      },
    },
    config: {
      type: "object",
      description: "Non-secret settings in force (models, endpoints, ids) — never a credential",
      additionalProperties: { type: "string" },
    },
  },
};

const VoiceAgentTool = {
  type: "object",
  required: ["name", "method", "url", "timeoutMs", "bodySchema"],
  properties: {
    name: { type: "string" },
    method: { type: "string" },
    url: { type: "string" },
    timeoutMs: { type: "integer", description: "Must exceed VOICE_TURN_TIMEOUT_MS" },
    headerNames: {
      type: "array",
      description: "Header names the tool sends. Values (the API key) are never returned.",
      items: { type: "string" },
    },
    bodySchema: { type: "object", additionalProperties: true },
  },
};

const VoiceAgentConfig = {
  type: "object",
  description:
    "Everything needed to wire an ElevenLabs Conversational AI agent to this deployment: the " +
    "custom server tool it calls, and the router prompt that keeps it from answering by itself.",
  required: ["prospect", "display_name", "provider", "tool", "system_prompt"],
  properties: {
    prospect: { type: "string" },
    display_name: { type: "string" },
    provider: { type: "string", enum: ["elevenlabs"] },
    agent_id: { type: ["string", "null"], description: "Non-secret agent id, null when unwired" },
    tool_id: { type: ["string", "null"], description: "The custom server tool's id in ElevenLabs" },
    ready: { type: "boolean", description: "An agent id is set and is not the example placeholder" },
    configured: { type: "boolean", description: "This deployment holds an ElevenLabs key" },
    voice_id: { type: ["string", "null"] },
    greeting: { type: "string" },
    handoff_msg: { type: "string" },
    tool: { $ref: "#/components/schemas/VoiceAgentTool" },
    system_prompt: { type: "string" },
    system_prompt_default: {
      type: "string",
      description: "What an empty override would give — so the editor can show what clearing it does",
    },
    system_prompt_custom: {
      type: "boolean",
      description: "The prompt is this prospect's own text rather than the generated default",
    },
    api_key: {
      type: ["object", "null"],
      description: "Which stored API key the tool's X-API-Key header carries — never the secret",
      properties: {
        id: { type: "string" },
        name: { type: "string" },
        prefix: { type: "string" },
      },
    },
    docs_url: { type: "string" },
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
  required: ["display_name", "region", "locale", "greeting", "handoff_msg"],
  properties: {
    display_name: { type: "string", minLength: 1, maxLength: 120 },
    kb_id: {
      type: "string",
      maxLength: 80,
      description: "ARAG Knowledge Box id. Empty = the deployment default (Settings → Connection).",
    },
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
    tool_id: { type: "string", maxLength: 120, description: "ElevenLabs custom server tool id" },
    system_prompt: {
      type: "string",
      maxLength: 8000,
      description: "Router prompt override; empty uses the generated default",
    },
    agent_api_key_id: {
      type: "string",
      maxLength: 80,
      description: "Which stored API key the pushed tool's X-API-Key header carries",
    },
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
  required: ["id", "display_name", "region", "locale", "greeting", "handoff_msg"],
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

const GoldenEvalSummary = {
  type: "object",
  description: "A golden run without the per-question detail (fetch it by id to see the cases)",
  required: ["id", "prospect", "ok", "total", "passed", "failed"],
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
    startedAt: { type: "string", format: "date-time" },
    finishedAt: { type: "string", format: "date-time" },
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

// ── settings ─────────────────────────────────────────────────────────────────

const SettingsField = {
  type: "object",
  description:
    "One editable setting. `value` carries the effective value; a secret carries `set` and a " +
    "`hint` instead, because a secret is written once and then rotated, never displayed.",
  required: ["key", "group", "label", "type", "env", "help", "source"],
  properties: {
    key: { type: "string" },
    group: { type: "string", enum: ["branding", "connection", "limits", "elevenlabs", "retention"] },
    label: { type: "string" },
    type: {
      type: "string",
      enum: ["string", "text", "number", "boolean", "color", "secret", "enum"],
    },
    env: { type: "string", description: "The environment variable that supplies the default" },
    help: { type: "string" },
    options: { type: "array", items: { type: "string" } },
    min: { type: "number" },
    max: { type: "number" },
    placeholder: { type: "string" },
    value: { description: "Effective value (absent for secrets)" },
    envValue: { description: "The boot-time default, so the UI can offer 'reset to environment'" },
    set: { type: "boolean", description: "Secrets only: is one configured" },
    hint: { type: "string", description: "Secrets only: enough to recognise the value, no more" },
    source: {
      type: "string",
      enum: ["stored", "env", "default"],
      description: "Where the effective value came from",
    },
  },
};

const SettingsGroupSchema = {
  type: "object",
  required: ["id", "title", "description", "fields"],
  properties: {
    id: { type: "string" },
    title: { type: "string" },
    description: { type: "string" },
    fields: { type: "array", items: { $ref: "#/components/schemas/SettingsField" } },
  },
};

const SettingsDocument = {
  type: "object",
  required: ["groups"],
  properties: {
    groups: { type: "array", items: { $ref: "#/components/schemas/SettingsGroup" } },
  },
};

const SettingsPatch = {
  type: "object",
  description:
    "Partial update, keyed by group then field. `null` resets a field to its environment " +
    "default. Unknown groups and fields are rejected rather than ignored.",
  properties: {
    branding: { type: "object", additionalProperties: true },
    connection: { type: "object", additionalProperties: true },
    limits: { type: "object", additionalProperties: true },
    elevenlabs: { type: "object", additionalProperties: true },
    retention: { type: "object", additionalProperties: true },
  },
  additionalProperties: false,
};

const ApiKey = {
  type: "object",
  description: "A stored API key. The secret is returned exactly once, when the key is created.",
  required: ["id", "name", "prefix", "origin", "createdAt", "uses", "revoked"],
  properties: {
    id: { type: "string" },
    name: { type: "string" },
    prefix: { type: "string", description: "Leading characters, enough to recognise the key" },
    origin: { type: "string", enum: ["env", "store"], description: "Seeded from API_KEYS, or minted here" },
    createdAt: { type: "string", format: "date-time" },
    lastUsedAt: { type: ["string", "null"], format: "date-time" },
    uses: { type: "integer", description: "Recorded uses (sampled at most every 30 s per key)" },
    revoked: { type: "boolean" },
    revokedAt: { type: ["string", "null"], format: "date-time" },
  },
};

const AgentDiffRow = {
  type: "object",
  required: ["field", "label", "local", "remote", "matches"],
  properties: {
    field: { type: "string" },
    label: { type: "string" },
    local: { type: "string", description: "What this deployment wants" },
    remote: { type: "string", description: "What ElevenLabs currently has" },
    matches: { type: "boolean" },
  },
};

const RemoteAgentState = {
  type: "object",
  description:
    "The agent and tool as ElevenLabs currently holds them, reduced to the fields this product owns",
  required: ["agent", "tool"],
  properties: {
    agent: {
      type: "object",
      required: ["found"],
      properties: {
        found: { type: "boolean" },
        agent_id: { type: "string" },
        name: { type: "string" },
        first_message: { type: "string" },
        system_prompt: { type: "string" },
        voice_id: { type: "string" },
        language: { type: "string" },
        tool_ids: { type: "array", items: { type: "string" } },
        error: { type: "string" },
      },
    },
    tool: {
      type: "object",
      required: ["found"],
      properties: {
        found: { type: "boolean" },
        tool_id: { type: "string" },
        name: { type: "string" },
        url: { type: "string" },
        method: { type: "string" },
        timeout_secs: { type: "integer" },
        header_names: {
          type: "array",
          description: "Header names only — the X-API-Key value is never returned",
          items: { type: "string" },
        },
        has_api_key_header: { type: "boolean" },
        error: { type: "string" },
      },
    },
  },
};

const PurgeResult = {
  type: "object",
  required: ["turns", "sessions", "evals", "at", "windows"],
  properties: {
    turns: { type: "integer" },
    sessions: { type: "integer" },
    evals: { type: "integer" },
    at: { type: "string", format: "date-time" },
    windows: {
      type: "object",
      properties: {
        turnDays: { type: "integer" },
        sessionDays: { type: "integer" },
        evalDays: { type: "integer" },
      },
    },
  },
};

const SetupStep = {
  type: "object",
  description: "One step of the first-run wizard, with whether this deployment has done it",
  required: ["id", "title", "body", "done", "optional"],
  properties: {
    id: { type: "string" },
    title: { type: "string" },
    body: { type: "string" },
    done: { type: "boolean" },
    optional: { type: "boolean", description: "The product works without this step" },
    detail: { type: "string", description: "What the product found when it checked" },
    href: { type: "string", description: "Where to go to do it" },
    action: { type: "string", description: "Label for the link" },
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
    { name: "realtime", description: "ElevenLabs Scribe, speech and agent configuration" },
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
    BriefSnapshot,
    ListenSessionExport,
    KnowledgeStatus,
    IntegrationStatus,
    VoiceAgentTool,
    VoiceAgentConfig,
    PipelineStep,
    SettingsField,
    SettingsGroup: SettingsGroupSchema,
    SettingsDocument,
    SettingsPatch,
    ApiKey,
    AgentDiffRow,
    RemoteAgentState,
    PurgeResult,
    SetupStep,
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
    GoldenEvalSummary,
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
        summary: "Search, filter and page past listen sessions",
        description:
          "Backs the Conversations list. `q` searches the prospect, the brief (topic, summary, goal, " +
          "profile), the accumulated source titles and the transcript itself, so an operator can find " +
          "a call by what was said in it rather than by its id.",
        parameters: [
          { name: "prospect", in: "query", schema: { type: "string", pattern: prospectKeyPattern } },
          { name: "status", in: "query", schema: { type: "string", enum: ["live", "ended"] } },
          {
            name: "q",
            in: "query",
            description: "Free text over prospect, brief, source titles and transcript",
            schema: { type: "string", maxLength: 200 },
          },
          {
            name: "from",
            in: "query",
            description: "Only sessions started at or after this instant",
            schema: { type: "string", format: "date-time" },
          },
          {
            name: "to",
            in: "query",
            description: "Only sessions started at or before this instant",
            schema: { type: "string", format: "date-time" },
          },
          {
            name: "sort",
            in: "query",
            schema: {
              type: "string",
              enum: ["started", "updated", "refreshes", "duration"],
              default: "started",
            },
          },
          { name: "order", in: "query", schema: { type: "string", enum: ["asc", "desc"], default: "desc" } },
          { name: "limit", in: "query", schema: { type: "integer", minimum: 1, maximum: 200, default: 25 } },
          { name: "offset", in: "query", schema: { type: "integer", minimum: 0, default: 0 } },
        ],
        responses: {
          200: jsonResponse({
            type: "object",
            required: ["items", "total", "limit", "offset"],
            properties: {
              items: { type: "array", items: { $ref: "#/components/schemas/ListenSession" } },
              total: { type: "integer", description: "Sessions matching the filters, before paging" },
              limit: { type: "integer" },
              offset: { type: "integer" },
            },
          }),
          ...standardResponses,
        },
        security: publicSecurity,
      },
    },
    "/api/v1/listen/sessions/{id}/export": {
      parameters: [pathId],
      get: {
        operationId: "exportListenSession",
        tags: ["listen"],
        summary: "Export the whole record of one call",
        description:
          "Returns every brief version with its timestamp and latency, the full transcript, the " +
          "accumulated citations and the session stats — as JSON, or as Markdown for a handover note.",
        parameters: [
          {
            name: "format",
            in: "query",
            schema: { type: "string", enum: ["json", "markdown"], default: "json" },
          },
        ],
        responses: {
          200: {
            description: "The session record",
            content: {
              "application/json": { schema: { $ref: "#/components/schemas/ListenSessionExport" } },
              "text/markdown": { schema: { type: "string" } },
            },
          },
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
    "/api/v1/listen/sessions/{id}/refresh": {
      parameters: [pathId],
      post: {
        operationId: "refreshListenSession",
        tags: ["listen"],
        summary: "Ask for one more brief refresh now",
        description:
          "The deliberate retry behind a stale brief. Without it the only way to provoke a refresh " +
          "is to append transcript, which would fabricate conversation that was never said. The " +
          "throttle's minimum gap still applies, and a refresh that finds nothing leaves the " +
          "previous brief exactly where it is.",
        responses: {
          200: jsonResponse({ $ref: "#/components/schemas/ListenSession" }, "The session after the refresh"),
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
    "/api/v1/speech": {
      post: {
        operationId: "createSpeech",
        tags: ["realtime"],
        summary: "Speak a line of the brief aloud (ElevenLabs text-to-speech)",
        description:
          "The optional spoken brief: Live can read the grounded brief, or the single line the " +
          "handler could say next, into their own ear. Nothing is ever injected into the call — this " +
          "returns audio to the browser that asked for it, and it is off by default.\n\n" +
          "Synthesis happens server-side so the ElevenLabs key never reaches a browser. Returns 503 " +
          "when the deployment has no key, which is how the toggle knows to stay hidden.",
        requestBody: jsonBody({
          type: "object",
          required: ["text"],
          properties: {
            text: { type: "string", minLength: 1, maxLength: 1200 },
            voice_id: { type: "string", maxLength: 120, description: "Overrides the configured voice" },
            prospect: {
              type: "string",
              pattern: prospectKeyPattern,
              description: "Use this prospect's configured voice",
            },
          },
          additionalProperties: false,
        }),
        responses: {
          200: {
            description: "The spoken line",
            content: { "audio/mpeg": { schema: { type: "string", format: "binary" } } },
          },
          503: {
            description: "ElevenLabs is not configured on this deployment; the toggle stays hidden",
            content: { "application/problem+json": { schema: { $ref: "#/components/schemas/Problem" } } },
          },
          ...standardResponses,
        },
        security: publicSecurity,
      },
    },
    "/api/v1/voice-agent": {
      get: {
        operationId: "getVoiceAgent",
        tags: ["realtime"],
        summary: "The ElevenLabs agent configuration for a prospect",
        description:
          "VoiceBridge is not a voice platform. The agent lives in ElevenLabs Conversational AI and " +
          "calls `POST /api/v1/voice-answer` as a custom server tool, so every spoken answer still " +
          "comes from the Knowledge Box. This returns exactly what has to be pasted into the " +
          "ElevenLabs dashboard — tool definition and router prompt — derived from the registry.",
        parameters: [
          {
            name: "prospect",
            in: "query",
            required: true,
            schema: { type: "string", pattern: prospectKeyPattern },
          },
        ],
        responses: {
          200: jsonResponse({ $ref: "#/components/schemas/VoiceAgentConfig" }),
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
    "/api/v1/turns": {
      get: {
        operationId: "listTurns",
        tags: ["quality"],
        summary: "The turn log behind the Quality view",
        description:
          "Recent turns, newest first, filterable by outcome so an operator can go straight to the " +
          "turns that handed off or tripped a safety guard. Question text is stored only for turns " +
          "that passed the input guard: a guard trip records the reason and nothing else.\n\n" +
          "Never anonymous, even when `API_KEYS` is unset: a same-origin session (`POST " +
          "/api/v1/session`, which the workspace calls at boot), an API key or the admin token is " +
          "required, because the questions people asked are not public.",
        parameters: [
          { name: "prospect", in: "query", schema: { type: "string", pattern: prospectKeyPattern } },
          {
            name: "outcome",
            in: "query",
            schema: { type: "string", enum: ["answered", "handoff", "guard"] },
          },
          { name: "source", in: "query", schema: { type: "string", enum: ["voice-answer", "golden-eval"] } },
          { name: "reason", in: "query", schema: { type: "string", maxLength: 60 } },
          { name: "limit", in: "query", schema: { type: "integer", minimum: 1, maximum: 500, default: 100 } },
          { name: "offset", in: "query", schema: { type: "integer", minimum: 0, default: 0 } },
        ],
        responses: {
          200: jsonResponse({
            type: "object",
            required: ["items", "total", "reasons"],
            properties: {
              items: { type: "array", items: { $ref: "#/components/schemas/TurnRecord" } },
              total: { type: "integer" },
              reasons: {
                type: "array",
                description: "Handoff and guard reasons in the window, most frequent first",
                items: {
                  type: "object",
                  required: ["reason", "count", "guard"],
                  properties: {
                    reason: { type: "string" },
                    count: { type: "integer" },
                    guard: { type: "boolean" },
                  },
                },
              },
            },
          }),
          ...standardResponses,
        },
        security: publicSecurity,
      },
    },
    "/api/v1/knowledge": {
      get: {
        operationId: "getKnowledge",
        tags: ["quality"],
        summary: "What a prospect is grounded in, and whether its golden gate is open",
        description:
          "Backs the Knowledge view: the Knowledge Box a prospect answers from (id partially masked — " +
          "the full id is admin-only), its connectivity, the models in play, the golden set, and the " +
          "most recent golden run.",
        parameters: [
          {
            name: "prospect",
            in: "query",
            required: true,
            schema: { type: "string", pattern: prospectKeyPattern },
          },
        ],
        responses: {
          200: jsonResponse({ $ref: "#/components/schemas/KnowledgeStatus" }),
          ...standardResponses,
        },
        security: publicSecurity,
      },
    },
    "/api/v1/integrations": {
      get: {
        operationId: "listIntegrations",
        tags: ["system"],
        summary: "Which optional integrations this deployment has configured",
        description:
          "Booleans and non-secret detail only — never a credential. Backs the Settings view so a " +
          "partner can see at a glance why the microphone or the spoken brief is unavailable.",
        responses: {
          200: jsonResponse({
            type: "object",
            required: ["items"],
            properties: {
              items: { type: "array", items: { $ref: "#/components/schemas/IntegrationStatus" } },
            },
          }),
          ...standardResponses,
        },
        security: publicSecurity,
      },
    },
    "/api/v1/golden-evals": {
      get: {
        operationId: "listGoldenEvals",
        tags: ["quality"],
        summary: "Golden-run history",
        parameters: [
          { name: "prospect", in: "query", schema: { type: "string", pattern: prospectKeyPattern } },
          { name: "limit", in: "query", schema: { type: "integer", minimum: 1, maximum: 100, default: 25 } },
          { name: "offset", in: "query", schema: { type: "integer", minimum: 0, default: 0 } },
        ],
        responses: {
          200: jsonResponse({
            type: "object",
            required: ["items", "total"],
            properties: {
              items: { type: "array", items: { $ref: "#/components/schemas/GoldenEvalSummary" } },
              total: { type: "integer" },
            },
          }),
          ...standardResponses,
        },
        security: publicSecurity,
      },
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
        summary: "Recent log records, filtered and paged",
        parameters: [
          {
            name: "level",
            in: "query",
            schema: { type: "string", enum: ["debug", "info", "warn", "error"] },
          },
          { name: "contains", in: "query", schema: { type: "string", maxLength: 200 } },
          { name: "limit", in: "query", schema: { type: "integer", minimum: 1, maximum: 500, default: 200 } },
          {
            name: "offset",
            in: "query",
            description: "Records to skip, newest first — the log page's pager",
            schema: { type: "integer", minimum: 0, default: 0 },
          },
        ],
        responses: {
          200: jsonResponse({
            type: "object",
            required: ["items", "total", "offset", "limit"],
            properties: {
              items: { type: "array", items: { $ref: "#/components/schemas/LogRecord" } },
              total: { type: "integer", description: "Matching records in the ring buffer" },
              offset: { type: "integer" },
              limit: { type: "integer" },
              ring: { type: "integer", description: "Size of the ring buffer itself" },
            },
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
    "/api/v1/listen/sessions/{id}/brief-history": {
      parameters: [pathId],
      get: {
        operationId: "listenBriefHistory",
        tags: ["listen"],
        summary: "Every version of this conversation's brief",
        description:
          "The brief is rebuilt as the call moves, and the interesting question in review is not " +
          "what it ended as but when it changed its mind. Each snapshot carries the version, the " +
          "instant and the whole brief, so two versions can be compared field by field.",
        responses: {
          200: jsonResponse({
            type: "object",
            required: ["items"],
            properties: {
              items: { type: "array", items: { $ref: "#/components/schemas/BriefSnapshot" } },
            },
          }),
          ...standardResponses,
        },
        security: publicSecurity,
      },
    },
    "/api/v1/setup": {
      get: {
        operationId: "getSetup",
        tags: ["system"],
        summary: "First-run checklist for this deployment",
        description:
          "What the onboarding wizard renders: each step with whether this deployment has already " +
          "done it, checked against the live configuration rather than a stored 'dismissed' flag.",
        responses: {
          200: jsonResponse({
            type: "object",
            required: ["steps", "complete"],
            properties: {
              steps: { type: "array", items: { $ref: "#/components/schemas/SetupStep" } },
              complete: { type: "boolean", description: "Every required step is done" },
              required_done: { type: "integer" },
              required_total: { type: "integer" },
            },
          }),
          ...standardResponses,
        },
        security: publicSecurity,
      },
    },
    "/api/v1/admin/settings": {
      get: {
        operationId: "adminGetSettings",
        tags: ["admin"],
        summary: "Every editable setting, with its effective value and where it came from",
        responses: {
          200: jsonResponse({ $ref: "#/components/schemas/SettingsDocument" }),
          ...standardResponses,
        },
        security: adminSecurity,
      },
      patch: {
        operationId: "adminUpdateSettings",
        tags: ["admin"],
        summary: "Change settings; they take effect immediately",
        description:
          "The store is the authority and the environment is only the default, so a change here " +
          "survives a restart and needs none. A change that would make every turn dead air (a " +
          "voice turn budget at or above the agent tool timeout) is rejected and rolled back.",
        requestBody: jsonBody({ $ref: "#/components/schemas/SettingsPatch" }),
        responses: {
          200: jsonResponse({ $ref: "#/components/schemas/SettingsDocument" }),
          ...standardResponses,
        },
        security: adminSecurity,
      },
    },
    "/api/v1/admin/settings/reset": {
      post: {
        operationId: "adminResetSettings",
        tags: ["admin"],
        summary: "Drop stored overrides and fall back to the environment",
        requestBody: jsonBody({
          type: "object",
          properties: {
            group: {
              type: "string",
              enum: ["branding", "connection", "limits", "elevenlabs", "retention"],
              description: "Omit to reset every group",
            },
          },
          additionalProperties: false,
        }),
        responses: {
          200: jsonResponse({ $ref: "#/components/schemas/SettingsDocument" }),
          ...standardResponses,
        },
        security: adminSecurity,
      },
    },
    "/api/v1/admin/settings/logo": {
      post: {
        operationId: "adminUploadLogo",
        tags: ["admin"],
        summary: "Upload a partner logo and point branding at it",
        description:
          "Stores the file under DATA_DIR/branding/ (served at /branding/) and sets the branding " +
          "logo URL to it. SVG, PNG, JPEG, WebP and GIF only, 1 MB max.",
        requestBody: {
          required: true,
          content: {
            "multipart/form-data": {
              schema: {
                type: "object",
                required: ["file"],
                properties: { file: { type: "string", format: "binary" } },
              },
            },
          },
        },
        responses: {
          200: jsonResponse({
            type: "object",
            required: ["logoUrl", "bytes", "contentType"],
            properties: {
              logoUrl: { type: "string" },
              bytes: { type: "integer" },
              contentType: { type: "string" },
            },
          }),
          ...standardResponses,
        },
        security: adminSecurity,
      },
      delete: {
        operationId: "adminDeleteLogo",
        tags: ["admin"],
        summary: "Remove the uploaded logo and fall back to the wordmark",
        responses: { 204: { description: "Removed" }, ...standardResponses },
        security: adminSecurity,
      },
    },
    "/api/v1/admin/api-keys": {
      get: {
        operationId: "adminListApiKeys",
        tags: ["admin"],
        summary: "The API key store",
        description:
          "`API_KEYS` seeds this store on first boot and then stops being the authority: keys " +
          "created or revoked here take effect on the next request.",
        responses: {
          200: jsonResponse({
            type: "object",
            required: ["items", "open"],
            properties: {
              items: { type: "array", items: { $ref: "#/components/schemas/ApiKey" } },
              open: {
                type: "boolean",
                description: "No active key: the public API is open to anyone who can reach it",
              },
              active: { type: "integer" },
            },
          }),
          ...standardResponses,
        },
        security: adminSecurity,
      },
      post: {
        operationId: "adminCreateApiKey",
        tags: ["admin"],
        summary: "Mint an API key",
        description: "The secret is in this response and nowhere else, ever again.",
        requestBody: jsonBody({
          type: "object",
          required: ["name"],
          properties: { name: { type: "string", minLength: 1, maxLength: 80 } },
          additionalProperties: false,
        }),
        responses: {
          201: jsonResponse(
            {
              type: "object",
              required: ["key", "secret"],
              properties: {
                key: { $ref: "#/components/schemas/ApiKey" },
                secret: { type: "string", description: "Shown once. Store it now." },
              },
            },
            "Key created",
          ),
          ...standardResponses,
        },
        security: adminSecurity,
      },
    },
    "/api/v1/admin/api-keys/{id}": {
      parameters: [pathId],
      patch: {
        operationId: "adminRenameApiKey",
        tags: ["admin"],
        summary: "Rename a key",
        requestBody: jsonBody({
          type: "object",
          required: ["name"],
          properties: { name: { type: "string", minLength: 1, maxLength: 80 } },
          additionalProperties: false,
        }),
        responses: {
          200: jsonResponse({ $ref: "#/components/schemas/ApiKey" }),
          ...standardResponses,
        },
        security: adminSecurity,
      },
      delete: {
        operationId: "adminRevokeApiKey",
        tags: ["admin"],
        summary: "Revoke a key",
        description:
          "The record stays, marked revoked — a revoked key that vanished would take its own " +
          "audit trail with it — but it stops authenticating immediately.",
        responses: {
          200: jsonResponse({ $ref: "#/components/schemas/ApiKey" }),
          ...standardResponses,
        },
        security: adminSecurity,
      },
    },
    "/api/v1/admin/voice-agent": {
      get: {
        operationId: "adminGetVoiceAgent",
        tags: ["admin"],
        summary: "Compare this prospect's desired agent with what ElevenLabs has",
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
            required: ["desired", "remote", "diff", "in_sync"],
            properties: {
              desired: { $ref: "#/components/schemas/VoiceAgentConfig" },
              remote: { $ref: "#/components/schemas/RemoteAgentState" },
              diff: { type: "array", items: { $ref: "#/components/schemas/AgentDiffRow" } },
              in_sync: { type: "boolean" },
              reachable: { type: "boolean", description: "ElevenLabs answered" },
            },
          }),
          ...standardResponses,
        },
        security: adminSecurity,
      },
    },
    "/api/v1/admin/voice-agent/push": {
      post: {
        operationId: "adminPushVoiceAgent",
        tags: ["admin"],
        summary: "Write this prospect's agent configuration to ElevenLabs",
        description:
          "Creates or patches the custom server tool (URL, X-API-Key header, timeout, body " +
          "schema), then the agent (router prompt, greeting, voice, tool link). Everything is " +
          "merged into what the remote already has, so configuration this product does not own " +
          "is left alone.",
        requestBody: jsonBody({
          type: "object",
          required: ["prospect"],
          properties: {
            prospect: { type: "string", pattern: prospectKeyPattern },
            api_key_id: {
              type: "string",
              maxLength: 80,
              description: "Which stored key the tool's X-API-Key header carries; omit to reuse or pick one",
            },
          },
          additionalProperties: false,
        }),
        responses: {
          200: jsonResponse({
            type: "object",
            required: ["applied", "agent", "tool"],
            properties: {
              applied: { type: "array", items: { type: "string" } },
              created_agent: { type: "boolean" },
              created_tool: { type: "boolean" },
              tool_id: { type: ["string", "null"] },
              agent: { type: "object", additionalProperties: true },
              tool: { type: "object", additionalProperties: true },
              prospect: { $ref: "#/components/schemas/ProspectRecord" },
            },
          }),
          ...standardResponses,
        },
        security: adminSecurity,
      },
    },
    "/api/v1/admin/listen-sessions/{id}": {
      parameters: [pathId],
      delete: {
        operationId: "adminDeleteListenSession",
        tags: ["admin"],
        summary: "Delete a conversation and everything recorded with it",
        description:
          "The transcript, the brief history and the citations go with it. Open subscribers are " +
          "told the session ended before the record is removed.",
        responses: { 204: { description: "Deleted" }, ...standardResponses },
        security: adminSecurity,
      },
    },
    "/api/v1/admin/purge": {
      post: {
        operationId: "adminPurge",
        tags: ["admin"],
        summary: "Apply the retention windows, or delete a class of records now",
        requestBody: jsonBody({
          type: "object",
          properties: {
            scope: {
              type: "string",
              enum: ["retention", "turns", "sessions", "evals", "all"],
              default: "retention",
              description: "`retention` applies the configured windows; the rest delete regardless of age",
            },
          },
          additionalProperties: false,
        }),
        responses: {
          200: jsonResponse({ $ref: "#/components/schemas/PurgeResult" }),
          ...standardResponses,
        },
        security: adminSecurity,
      },
    },
  },
});
