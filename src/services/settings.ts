/**
 * Deployment settings — every configurable value in one declarative table.
 *
 * The rule this service implements (full-implementation brief §1): *environment variables are
 * defaults, the store is the authority, and a change takes effect without a restart.* Nothing the
 * product reads from configuration is read-only in the UI except secrets, which are set once and
 * then reported as "set · rotate".
 *
 * How "without a restart" works: `PlatformEnv` and `VoiceConfig` are built once at boot and every
 * route, service and client holds that *same object*. This service therefore does not rebuild
 * them — it writes into them. `apply()` walks the field table and assigns the effective value
 * (stored override, else the boot-time default) into the live objects, so the next request reads
 * the new value with no re-wiring anywhere.
 *
 * One table drives everything: validation, the admin API, the Settings screens and the settings
 * inventory in the docs. Adding a setting means adding one row here.
 */
import {
  type Collection,
  isSafeColor,
  type Logger,
  type PlatformEnv,
  type Store,
  type StoredDoc,
} from "../../vendor/arag-platform/src/index.ts";
import { assertVoiceConfig, type VoiceConfig } from "../config.ts";
import type { FieldError } from "./registry.ts";
import { ValidationFailed } from "./registry.ts";

export type SettingsGroupId = "branding" | "connection" | "limits" | "elevenlabs" | "retention";

export type FieldType = "string" | "text" | "number" | "boolean" | "color" | "secret" | "enum";

/** The two live objects every field reads from and writes into. */
export interface LiveConfig {
  env: PlatformEnv;
  voice: VoiceConfig;
}

export interface FieldSpec {
  key: string;
  group: SettingsGroupId;
  label: string;
  type: FieldType;
  /** The environment variable that supplies this field's default. */
  env: string;
  help: string;
  options?: string[];
  min?: number;
  max?: number;
  placeholder?: string;
  /** Changing this field invalidates the cached per-prospect ARAG clients. */
  rewiresClients?: boolean;
  read(c: LiveConfig): unknown;
  write(c: LiveConfig, value: unknown): void;
}

export interface SettingsGroup {
  id: SettingsGroupId;
  title: string;
  description: string;
}

export const SETTINGS_GROUPS: SettingsGroup[] = [
  {
    id: "branding",
    title: "Branding",
    description:
      "How this deployment identifies itself. A partner rebrands without a fork; per-prospect " +
      "overlays layer on top of these under Prospects.",
  },
  {
    id: "connection",
    title: "Connection",
    description:
      "How the bridge reaches Progress Agentic RAG. The Knowledge Box here is the deployment " +
      "default — a prospect may point at its own.",
  },
  {
    id: "limits",
    title: "Limits and timeouts",
    description:
      "The budgets that keep a voice turn inside the agent's tool timeout and stop one caller " +
      "spending everyone's quota.",
  },
  {
    id: "elevenlabs",
    title: "ElevenLabs",
    description:
      "The default voice stack: Scribe transcription, the Conversational AI agent and the " +
      "optional spoken brief.",
  },
  {
    id: "retention",
    title: "Retention",
    description: "How long recorded turns, conversations and golden runs are kept before purging.",
  },
];

const str = (v: unknown) => String(v ?? "").trim();

function field(spec: FieldSpec): FieldSpec {
  return spec;
}

/** Branding is a plain record on the live config, so its fields are one shape. */
function brandField(
  key: keyof VoiceConfig["branding"],
  label: string,
  env: string,
  help: string,
  type: FieldType = "string",
): FieldSpec {
  return field({
    key,
    group: "branding",
    label,
    type,
    env,
    help,
    read: (c) => c.voice.branding[key],
    write: (c, v) => {
      (c.voice.branding as unknown as Record<string, unknown>)[key] =
        type === "boolean" ? Boolean(v) : str(v);
    },
  });
}

function numField(
  group: SettingsGroupId,
  key: string,
  label: string,
  env: string,
  help: string,
  read: (c: LiveConfig) => number,
  write: (c: LiveConfig, v: number) => void,
  min: number,
  max: number,
): FieldSpec {
  return field({
    key,
    group,
    label,
    type: "number",
    env,
    help,
    min,
    max,
    read,
    write: (c, v) => write(c, Number(v)),
  });
}

/**
 * Every setting this product has. Order is display order.
 *
 * `rewiresClients` marks the fields that change how a Knowledge Box is reached, so the client
 * pool is dropped after the change instead of serving the next turn from a stale client.
 */
export const SETTINGS_FIELDS: FieldSpec[] = [
  // ── branding ───────────────────────────────────────────────────────────────
  brandField(
    "productName",
    "Product name",
    "BRAND_PRODUCT_NAME",
    "Shown on the rail, in the tab title and in the docs.",
  ),
  brandField("tagline", "Tagline", "BRAND_TAGLINE", "One line under the product name."),
  brandField(
    "logoUrl",
    "Logo",
    "BRAND_LOGO_URL",
    "Replaces the Progress wordmark on the rail. Upload a file or paste a URL.",
  ),
  brandField("primaryColor", "Primary colour", "BRAND_PRIMARY_COLOR", "The action colour.", "color"),
  brandField(
    "accentColor",
    "Accent colour",
    "BRAND_ACCENT_COLOR",
    "The liveness colour on dark surfaces.",
    "color",
  ),
  brandField("footerText", "Footer text", "BRAND_FOOTER_TEXT", "Shown at the foot of the rail."),
  brandField("docsUrl", "Docs link", "BRAND_DOCS_URL", "Where the rail's API-docs link points."),
  brandField("supportUrl", "Support link", "BRAND_SUPPORT_URL", "Optional support destination."),
  brandField(
    "poweredBy",
    "Show the Progress credit",
    "BRAND_POWERED_BY",
    "Off removes the wordmark and the credit from the UI. Attribution stays in LICENSE and THIRD_PARTY_NOTICES.",
    "boolean",
  ),

  // ── connection ─────────────────────────────────────────────────────────────
  field({
    key: "kbId",
    group: "connection",
    label: "Knowledge Box id",
    type: "string",
    env: "ARAG_KB_ID",
    help: "The deployment default. A prospect with no kb_id of its own answers from this one.",
    rewiresClients: true,
    read: (c) => c.env.arag.kbId,
    write: (c, v) => {
      c.env.arag.kbId = str(v);
    },
  }),
  field({
    key: "apiKey",
    group: "connection",
    label: "Service-account token",
    type: "secret",
    env: "ARAG_API_KEY",
    help: "Sent as X-NUCLIA-SERVICEACCOUNT. Set once, then rotated — never displayed.",
    rewiresClients: true,
    read: (c) => c.env.arag.apiKey,
    write: (c, v) => {
      c.env.arag.apiKey = str(v);
    },
  }),
  field({
    key: "region",
    group: "connection",
    label: "Region",
    type: "string",
    env: "ARAG_REGION",
    help: "Zone slug, e.g. aws-us-east-2-1. Used to build the host when no base URL is set.",
    rewiresClients: true,
    read: (c) => c.env.arag.region,
    write: (c, v) => {
      c.env.arag.region = str(v);
      c.voice.aragRegionDefault = str(v) || c.voice.aragRegionDefault;
    },
  }),
  field({
    key: "baseUrl",
    group: "connection",
    label: "Base URL override",
    type: "string",
    env: "ARAG_BASE_URL",
    help: "Full API base, e.g. https://aws-us-east-2-1.dp.progress.cloud/api/v1. Empty = derive from the region.",
    placeholder: "https://<region>.dp.progress.cloud/api/v1",
    rewiresClients: true,
    read: (c) => c.env.arag.baseUrl,
    write: (c, v) => {
      c.env.arag.baseUrl = str(v);
    },
  }),
  field({
    key: "generativeModel",
    group: "connection",
    label: "Generative model",
    type: "string",
    env: "ARAG_GENERATIVE_MODEL",
    help: "Empty = the Knowledge Box default. A prospect may override it.",
    read: (c) => c.env.arag.generativeModel,
    write: (c, v) => {
      c.env.arag.generativeModel = str(v);
    },
  }),
  field({
    key: "reranker",
    group: "connection",
    label: "Reranker",
    type: "enum",
    env: "ARAG_RERANKER",
    options: ["predict", "noop"],
    help: "predict reranks retrieval with the platform model; noop keeps the retrieval order.",
    read: (c) => c.env.arag.reranker,
    write: (c, v) => {
      c.env.arag.reranker = str(v) || "predict";
    },
  }),
  field({
    key: "publicUrl",
    group: "connection",
    label: "Public URL",
    type: "string",
    env: "PUBLIC_URL",
    help:
      "How the outside world reaches this deployment. The ElevenLabs tool URL is built from it, " +
      "so getting it wrong is the usual reason a pushed agent cannot call back.",
    placeholder: "https://your-deployment.example.com",
    read: (c) => c.env.publicUrl,
    write: (c, v) => {
      c.env.publicUrl = str(v).replace(/\/+$/, "");
    },
  }),
  numField(
    "connection",
    "timeoutMs",
    "Client timeout",
    "ARAG_TIMEOUT_MS",
    "Default per-request budget for ARAG calls (ms). The voice turn uses its own, shorter one.",
    (c) => c.env.arag.timeoutMs,
    (c, v) => {
      c.env.arag.timeoutMs = v;
    },
    1000,
    600_000,
  ),

  // ── limits ─────────────────────────────────────────────────────────────────
  numField(
    "limits",
    "turnTimeoutMs",
    "Voice turn budget",
    "VOICE_TURN_TIMEOUT_MS",
    "Per-turn ARAG budget (ms). Must stay below the agent tool timeout or the caller hears silence.",
    (c) => c.voice.turnTimeoutMs,
    (c, v) => {
      c.voice.turnTimeoutMs = v;
    },
    500,
    60_000,
  ),
  numField(
    "limits",
    "agentToolTimeoutMs",
    "Agent tool timeout",
    "AGENT_TOOL_TIMEOUT_MS",
    "The timeout configured on the ElevenLabs custom server tool (ms). Pushed to the agent.",
    (c) => c.voice.agentToolTimeoutMs,
    (c, v) => {
      c.voice.agentToolTimeoutMs = v;
    },
    1000,
    120_000,
  ),
  numField(
    "limits",
    "briefTimeoutMs",
    "Brief budget",
    "VOICE_BRIEF_TIMEOUT_MS",
    "Listen-mode brief budget (ms). Longer than a turn because it never blocks speech.",
    (c) => c.voice.briefTimeoutMs,
    (c, v) => {
      c.voice.briefTimeoutMs = v;
    },
    1000,
    120_000,
  ),
  numField(
    "limits",
    "maxHistoryTurns",
    "History turns",
    "MAX_HISTORY_TURNS",
    "Prior turns forwarded to ARAG as context (one turn = caller + agent).",
    (c) => c.voice.maxHistoryTurns,
    (c, v) => {
      c.voice.maxHistoryTurns = v;
    },
    0,
    40,
  ),
  numField(
    "limits",
    "turnLogLimit",
    "Turn log size",
    "VOICE_TURN_LOG_LIMIT",
    "How many recent turns the ring keeps for metrics and the turn log.",
    (c) => c.voice.turnLogLimit,
    (c, v) => {
      c.voice.turnLogLimit = v;
    },
    10,
    10_000,
  ),
  numField(
    "limits",
    "rateLimitRps",
    "API rate limit",
    "RATE_LIMIT_RPS",
    "Global per-IP requests per second for /api/v1. 0 disables the limiter.",
    (c) => c.env.rateLimitRps,
    (c, v) => {
      c.env.rateLimitRps = v;
    },
    0,
    1000,
  ),
  numField(
    "limits",
    "rateLimitBurst",
    "API burst",
    "RATE_LIMIT_BURST",
    "Bucket size for the global per-IP limiter.",
    (c) => c.env.rateLimitBurst,
    (c, v) => {
      c.env.rateLimitBurst = v;
    },
    1,
    10_000,
  ),
  numField(
    "limits",
    "maxBodyBytes",
    "Max request body",
    "MAX_BODY_BYTES",
    "Largest accepted request body, in bytes.",
    (c) => c.env.maxBodyBytes,
    (c, v) => {
      c.env.maxBodyBytes = v;
    },
    1024,
    64 * 1024 * 1024,
  ),
  numField(
    "limits",
    "briefRps",
    "Brief rate limit",
    "VOICE_BRIEF_RATE_RPS",
    "Per-IP requests per second for /api/v1/brief and listen transcript ingest — each spends a generation.",
    (c) => c.voice.briefRps,
    (c, v) => {
      c.voice.briefRps = v;
    },
    0,
    100,
  ),
  numField(
    "limits",
    "briefBurst",
    "Brief burst",
    "VOICE_BRIEF_RATE_BURST",
    "Bucket size for the brief limiter.",
    (c) => c.voice.briefBurst,
    (c, v) => {
      c.voice.briefBurst = v;
    },
    1,
    1000,
  ),
  numField(
    "limits",
    "scribeRps",
    "Scribe token rate limit",
    "VOICE_SCRIBE_RATE_RPS",
    "Per-IP requests per second for minting ElevenLabs Scribe tokens.",
    (c) => c.voice.scribeRps,
    (c, v) => {
      c.voice.scribeRps = v;
    },
    0,
    100,
  ),
  numField(
    "limits",
    "scribeBurst",
    "Scribe token burst",
    "VOICE_SCRIBE_RATE_BURST",
    "Bucket size for the Scribe-token limiter.",
    (c) => c.voice.scribeBurst,
    (c, v) => {
      c.voice.scribeBurst = v;
    },
    1,
    1000,
  ),
  numField(
    "limits",
    "ttsRps",
    "Speech rate limit",
    "VOICE_TTS_RATE_RPS",
    "Per-IP requests per second for the spoken brief — it costs per character.",
    (c) => c.voice.ttsRps,
    (c, v) => {
      c.voice.ttsRps = v;
    },
    0,
    100,
  ),
  numField(
    "limits",
    "ttsBurst",
    "Speech burst",
    "VOICE_TTS_RATE_BURST",
    "Bucket size for the speech limiter.",
    (c) => c.voice.ttsBurst,
    (c, v) => {
      c.voice.ttsBurst = v;
    },
    1,
    1000,
  ),

  // ── ElevenLabs ─────────────────────────────────────────────────────────────
  field({
    key: "apiKey",
    group: "elevenlabs",
    label: "API key",
    type: "secret",
    env: "ELEVENLABS_API_KEY",
    help: "Server-side only. Mints Scribe tokens, lists voices, synthesises speech and configures agents.",
    read: (c) => c.voice.elevenLabsApiKey,
    write: (c, v) => {
      c.voice.elevenLabsApiKey = str(v);
    },
  }),
  field({
    key: "apiBase",
    group: "elevenlabs",
    label: "API base URL",
    type: "string",
    env: "ELEVENLABS_API_BASE",
    help: "Override for a regional endpoint or a test double.",
    read: (c) => c.voice.elevenLabsApiBase,
    write: (c, v) => {
      c.voice.elevenLabsApiBase = str(v) || "https://api.elevenlabs.io";
    },
  }),
  field({
    key: "scribeModel",
    group: "elevenlabs",
    label: "Transcription model",
    type: "string",
    env: "ELEVENLABS_SCRIBE_MODEL",
    help: "Realtime model used by the Live microphone.",
    read: (c) => c.voice.scribeModel,
    write: (c, v) => {
      c.voice.scribeModel = str(v) || "scribe_v2_realtime";
    },
  }),
  field({
    key: "ttsModel",
    group: "elevenlabs",
    label: "Speech model",
    type: "string",
    env: "ELEVENLABS_TTS_MODEL",
    help: "Low-latency model for the spoken brief.",
    read: (c) => c.voice.ttsModelId,
    write: (c, v) => {
      c.voice.ttsModelId = str(v) || "eleven_flash_v2_5";
    },
  }),
  field({
    key: "ttsVoiceId",
    group: "elevenlabs",
    label: "Default voice",
    type: "string",
    env: "ELEVENLABS_TTS_VOICE_ID",
    help: "Voice for the spoken brief when a prospect has none of its own.",
    read: (c) => c.voice.ttsVoiceId,
    write: (c, v) => {
      c.voice.ttsVoiceId = str(v);
    },
  }),
  field({
    key: "defaultAgentId",
    group: "elevenlabs",
    label: "Default agent id",
    type: "string",
    env: "VOICE_DEFAULT_AGENT_ID",
    help: "Agent used by a prospect that has none of its own.",
    read: (c) => c.voice.defaultAgentId,
    write: (c, v) => {
      c.voice.defaultAgentId = str(v);
    },
  }),

  // ── retention ──────────────────────────────────────────────────────────────
  numField(
    "retention",
    "turnDays",
    "Keep turns for",
    "VOICE_RETENTION_TURN_DAYS",
    "Days a recorded turn is kept. 0 keeps them until the ring evicts them.",
    (c) => c.voice.retentionTurnDays,
    (c, v) => {
      c.voice.retentionTurnDays = v;
    },
    0,
    3650,
  ),
  numField(
    "retention",
    "sessionDays",
    "Keep conversations for",
    "VOICE_RETENTION_SESSION_DAYS",
    "Days an ended listen session (with its transcript) is kept.",
    (c) => c.voice.retentionSessionDays,
    (c, v) => {
      c.voice.retentionSessionDays = v;
    },
    0,
    3650,
  ),
  numField(
    "retention",
    "evalDays",
    "Keep golden runs for",
    "VOICE_RETENTION_EVAL_DAYS",
    "Days a golden-set evaluation result is kept.",
    (c) => c.voice.retentionEvalDays,
    (c, v) => {
      c.voice.retentionEvalDays = v;
    },
    0,
    3650,
  ),
  field({
    key: "autoPurge",
    group: "retention",
    label: "Purge automatically",
    type: "boolean",
    env: "VOICE_RETENTION_AUTO_PURGE",
    help: "Apply the retention windows on a timer as well as on demand.",
    read: (c) => c.voice.retentionAutoPurge,
    write: (c, v) => {
      c.voice.retentionAutoPurge = Boolean(v);
    },
  }),
];

const FIELD_INDEX = new Map(SETTINGS_FIELDS.map((f) => [`${f.group}.${f.key}`, f]));

/** A settings override document. One row per group, values keyed by field. */
interface SettingsDoc extends StoredDoc {
  values: Record<string, Record<string, unknown>>;
}

export type SettingsPatch = Partial<Record<SettingsGroupId, Record<string, unknown>>>;

/** One field, as the admin API and the Settings screens see it. */
export interface DescribedField {
  key: string;
  group: SettingsGroupId;
  label: string;
  type: FieldType;
  env: string;
  help: string;
  options?: string[];
  min?: number;
  max?: number;
  placeholder?: string;
  /** Absent for secrets. */
  value?: unknown;
  /** Secrets only: is one configured, and a hint that identifies it without revealing it. */
  set?: boolean;
  hint?: string;
  /** Secrets only: would resetting this field restore one from the environment? Never the value. */
  envSet?: boolean;
  /** Where the effective value came from. */
  source: "stored" | "env" | "default";
  /** The boot-time default, so the UI can offer "reset to the environment". */
  envValue?: unknown;
}

export interface DescribedGroup extends SettingsGroup {
  fields: DescribedField[];
}

/** Show enough of a secret to recognise it, and no more. */
export function maskSecret(value: string): string {
  if (!value) return "";
  return value.length <= 8 ? "••••" : `••••${value.slice(-4)}`;
}

export interface SettingsDeps {
  store: Store;
  log: Logger;
  env: PlatformEnv;
  voice: VoiceConfig;
  /**
   * The raw environment, used only to tell "the variable is set to 0/false/empty" apart from "the
   * variable is not set at all". Both produce the same effective value, and a settings screen that
   * cannot distinguish them tells an operator the wrong story about where a value came from.
   */
  envSrc?: Record<string, string | undefined>;
  /** Called after a change that invalidates the cached ARAG clients. */
  onRewire?: () => void;
}

export class SettingsService {
  private readonly col: Collection<SettingsDoc>;
  private readonly live: LiveConfig;
  private readonly log: Logger;
  private readonly onRewire?: () => void;
  /** The boot-time (environment) values, captured before any stored override is applied. */
  private readonly defaults = new Map<string, unknown>();
  /** Which fields had their environment variable actually present at boot. */
  private readonly fromEnv = new Set<string>();

  constructor(deps: SettingsDeps) {
    this.col = deps.store.collection<SettingsDoc>("settings");
    this.live = { env: deps.env, voice: deps.voice };
    this.log = deps.log;
    this.onRewire = deps.onRewire;
    const src = deps.envSrc ?? process.env;
    for (const f of SETTINGS_FIELDS) {
      const id = `${f.group}.${f.key}`;
      this.defaults.set(id, f.read(this.live));
      if (src[f.env] !== undefined && src[f.env] !== "") this.fromEnv.add(id);
    }
  }

  private doc(): SettingsDoc {
    return this.col.get("deployment") ?? ({ id: "deployment", values: {} } as SettingsDoc);
  }

  /** The stored overrides, as a plain nested record. */
  overrides(): Record<string, Record<string, unknown>> {
    return this.doc().values ?? {};
  }

  /**
   * Assign the effective value of every field into the live config objects.
   *
   * Returns the fields whose value actually moved, so a caller can drop the cached ARAG clients
   * only when something that changes how a Knowledge Box is reached has changed — `rewiresClients`
   * is behaviour, not documentation.
   */
  apply(): string[] {
    const values = this.overrides();
    const moved: string[] = [];
    for (const f of SETTINGS_FIELDS) {
      const id = `${f.group}.${f.key}`;
      const stored = values[f.group]?.[f.key];
      const before = f.read(this.live);
      f.write(this.live, stored === undefined ? this.defaults.get(id) : stored);
      if (f.read(this.live) !== before) moved.push(id);
    }
    if (moved.some((id) => FIELD_INDEX.get(id)?.rewiresClients)) this.onRewire?.();
    return moved;
  }

  /** The effective value of one field. */
  value(group: SettingsGroupId, key: string): unknown {
    const f = FIELD_INDEX.get(`${group}.${key}`);
    return f ? f.read(this.live) : undefined;
  }

  /** Every group and field, with the effective value, its source and secrets masked. */
  describe(): DescribedGroup[] {
    const values = this.overrides();
    return SETTINGS_GROUPS.map((g) => ({
      ...g,
      fields: SETTINGS_FIELDS.filter((f) => f.group === g.id).map((f) => {
        const id = `${g.id}.${f.key}`;
        const stored = values[g.id]?.[f.key];
        const effective = f.read(this.live);
        const envDefault = this.defaults.get(id);
        const base: DescribedField = {
          key: f.key,
          group: f.group,
          label: f.label,
          type: f.type,
          env: f.env,
          help: f.help,
          // "env" means the variable was actually set at boot — including to 0, false or an empty
          // string — not merely that the effective value is truthy.
          source: stored !== undefined ? "stored" : this.fromEnv.has(id) ? "env" : "default",
        };
        if (f.options) base.options = f.options;
        if (f.min !== undefined) base.min = f.min;
        if (f.max !== undefined) base.max = f.max;
        if (f.placeholder) base.placeholder = f.placeholder;
        if (f.type === "secret") {
          base.set = Boolean(effective);
          base.hint = maskSecret(String(effective ?? ""));
          // Never the value, but whether resetting would restore one is not itself a secret.
          base.envSet = Boolean(envDefault);
        } else {
          base.value = effective;
          base.envValue = envDefault;
        }
        return base;
      }),
    }));
  }

  /**
   * Validate a patch. Unknown groups and fields are rejected rather than silently dropped: a
   * typo in a settings call should fail loudly, not appear to work.
   */
  validate(patch: SettingsPatch): FieldError[] {
    const errors: FieldError[] = [];
    for (const [group, fields] of Object.entries(patch)) {
      if (!SETTINGS_GROUPS.some((g) => g.id === group)) {
        errors.push({ path: `/${group}`, message: "is not a settings group" });
        continue;
      }
      if (fields === null || typeof fields !== "object" || Array.isArray(fields)) {
        errors.push({ path: `/${group}`, message: "must be an object of field values" });
        continue;
      }
      for (const [key, value] of Object.entries(fields as Record<string, unknown>)) {
        const f = FIELD_INDEX.get(`${group}.${key}`);
        const path = `/${group}/${key}`;
        if (!f) {
          errors.push({ path, message: "is not a setting" });
          continue;
        }
        if (value === null) continue; // null means "reset to the environment default"
        switch (f.type) {
          case "number": {
            const n = Number(value);
            if (!Number.isFinite(n)) errors.push({ path, message: "must be a number" });
            else if (f.min !== undefined && n < f.min)
              errors.push({ path, message: `must be at least ${f.min}` });
            else if (f.max !== undefined && n > f.max)
              errors.push({ path, message: `must be at most ${f.max}` });
            break;
          }
          case "boolean":
            if (typeof value !== "boolean") errors.push({ path, message: "must be true or false" });
            break;
          case "enum":
            if (!f.options?.includes(String(value)))
              errors.push({ path, message: `must be one of ${f.options?.join(", ")}` });
            break;
          case "color":
            if (typeof value !== "string") errors.push({ path, message: "must be a string" });
            else if (value !== "" && !isSafeColor(value))
              errors.push({
                path,
                message: "must be a hex, rgb(), hsl() or keyword colour (it is interpolated into CSS)",
              });
            break;
          default:
            if (typeof value !== "string") errors.push({ path, message: "must be a string" });
            else if (value.length > 4000) errors.push({ path, message: "must be at most 4000 characters" });
        }
      }
    }
    return errors;
  }

  /**
   * Merge a patch, persist it and apply it live. `null` resets a field to its environment default.
   * Throws `ValidationFailed` (mapped to 422) when the patch is invalid or would leave the
   * deployment in a state that makes every turn dead air.
   */
  update(patch: SettingsPatch, actor = "operator"): DescribedGroup[] {
    const errors = this.validate(patch);
    if (errors.length) throw new ValidationFailed(errors);

    const before = JSON.parse(JSON.stringify(this.overrides())) as Record<string, Record<string, unknown>>;
    const next: Record<string, Record<string, unknown>> = JSON.parse(JSON.stringify(before));
    const changed: string[] = [];
    for (const [group, fields] of Object.entries(patch)) {
      next[group] ??= {};
      for (const [key, value] of Object.entries(fields as Record<string, unknown>)) {
        const f = FIELD_INDEX.get(`${group}.${key}`)!;
        if (value === null) delete next[group]![key];
        else next[group]![key] = f.type === "number" ? Number(value) : value;
        changed.push(`${group}.${key}`);
      }
      if (Object.keys(next[group]!).length === 0) delete next[group];
    }

    this.col.put({ id: "deployment", values: next });
    this.apply();
    try {
      assertVoiceConfig(this.live.env, this.live.voice);
    } catch (err) {
      this.col.put({ id: "deployment", values: before });
      this.apply();
      // Name the field, not the group: the screen puts an error against an input, and "/limits"
      // would leave it guessing which of fourteen.
      const message = (err as Error).message;
      const field = SETTINGS_FIELDS.find((f) => f.group === "limits" && message.includes(f.env));
      throw new ValidationFailed([{ path: field ? `/limits/${field.key}` : "/limits", message }]);
    }
    // Audited in the operator log: who, what and when. Values are deliberately not logged —
    // some of them are secrets and all of them are visible in the settings API.
    this.log.info("settings.changed", { actor, fields: changed, at: new Date().toISOString() });
    return this.describe();
  }

  /** Drop every stored override (or one group's) and fall back to the environment. */
  reset(group?: SettingsGroupId, actor = "operator"): DescribedGroup[] {
    const values = JSON.parse(JSON.stringify(this.overrides())) as Record<string, Record<string, unknown>>;
    if (group) delete values[group];
    this.col.put({ id: "deployment", values: group ? values : {} });
    this.apply();
    this.log.info("settings.reset", { actor, group: group ?? "all", at: new Date().toISOString() });
    return this.describe();
  }

  /** Does any field in this group override the environment? */
  isOverridden(group: SettingsGroupId): boolean {
    return Object.keys(this.overrides()[group] ?? {}).length > 0;
  }
}
