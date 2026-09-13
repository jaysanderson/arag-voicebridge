/**
 * Product types for VoiceBridge.
 *
 * The request/response contracts here are the public API contract (see `src/openapi.ts`);
 * ARAG-facing shapes live in the platform client (`vendor/arag-platform/src/arag`).
 */

import type { Branding } from "../vendor/arag-platform/src/index.ts";

/** Conversation roles as ARAG expects them in `context`. */
export type Author = "USER" | "NUCLIA";

/** One prior turn of conversation, forwarded to ARAG as context. */
export interface HistoryTurn {
  author: Author;
  text: string;
}

/** Request body for POST /api/v1/voice-answer (and the /v1/voice-answer compatibility alias). */
export interface VoiceAnswerRequest {
  prospect: string;
  question: string;
  conversation_id?: string;
  history?: HistoryTurn[];
  /** Optional per-request generative model override (from the UI model dropdown). */
  generative_model?: string;
}

/** A citation surfaced in the UI — never spoken. */
export interface Citation {
  title: string;
  url: string;
  score: number;
}

/** Per-turn latency breakdown (ms). */
export interface LatencyMs {
  /** Time until ARAG's retrieval items were available. */
  retrieve: number;
  /** Time to first answer token from ARAG. */
  first_token: number;
  /** Total bridge turn time, end to end. */
  total: number;
}

/** Response body returned to the ElevenLabs agent tool and the demo console. */
export interface VoiceAnswerResponse {
  answer: string;
  citations: Citation[];
  handoff: boolean;
  latency_ms: LatencyMs;
  /** Why the turn handed off (never spoken; useful for the console + turn log). */
  handoff_reason?: HandoffReason | GuardReason;
}

export type HandoffReason =
  | "sentinel"
  | "not-found-phrase"
  | "empty-answer"
  | "no-retrieval"
  | "upstream-error";

export type GuardReason =
  | "empty-question"
  | "question-too-long"
  | "prompt-injection"
  | "unsafe-request"
  | "empty-output"
  | "unspeakable-content";

/**
 * A golden-set question. `expect` lets the harness assert behaviour, not just
 * "didn't crash": "answer" must be grounded; "handoff" must escalate.
 */
export interface GoldenQuestion {
  q: string;
  expect: "answer" | "handoff";
  /** Optional substrings the spoken answer should contain (case-insensitive). */
  must_include?: string[];
}

/** A single prospect entry in the registry (persisted in DATA_DIR/prospects.json). */
export interface ProspectConfig {
  display_name: string;
  kb_id: string;
  region: string;
  /** Stored ask search_configuration name. Optional — omit to use the inline config below. */
  ask_config?: string;
  /** Reranker for the inline path: "noop" (default) | "predict". */
  reranker?: string;
  /** Max generated tokens for the inline path (default 160). */
  max_tokens?: number;
  /** Override the KB's default generative model (inline path). */
  generative_model?: string;
  /** Generation temperature (inline path). Defaults to 0 for deterministic demos. */
  temperature?: number;
  /** Fast model used for the live brief (Listen mode) — the brief needs low latency. */
  brief_model?: string;
  /** Non-secret ElevenLabs identifiers (used by the browser, not the server). */
  agent_id?: string;
  voice_id?: string;
  locale: string;
  greeting: string;
  handoff_msg: string;
  golden_questions?: GoldenQuestion[];
  /**
   * Per-prospect white-label overrides, layered on top of the deployment's BRAND_* branding.
   * A partner running one deployment for several of their own customers sets these per prospect.
   */
  brand?: ProspectBrand;
}

/** The subset of branding a prospect may override (never secrets, never behaviour). */
export interface ProspectBrand {
  productName?: string;
  tagline?: string;
  logoUrl?: string;
  primaryColor?: string;
  accentColor?: string;
  footerText?: string;
  poweredBy?: boolean;
}

/** A prospect as stored (registry key + config + store timestamps). */
export interface ProspectRecord extends ProspectConfig {
  id: string;
  createdAt: string;
  updatedAt: string;
}

/** The registry is a map of prospect key → config. */
export type Registry = Record<string, ProspectConfig>;

/** Non-secret projection sent to browsers. */
export interface PublicProspect {
  key: string;
  display_name: string;
  locale: string;
  greeting: string;
  handoff_msg: string;
  agent_id: string | null;
  voice_id: string | null;
  golden_questions: GoldenQuestion[];
  scribe_ready: boolean;
  /** Branding for this prospect: the deployment's branding with its overrides applied. */
  brand: Branding;
}

/** Where a safety guard sits in the pipeline. */
export type GuardStage = "input" | "output";

/** Result of a safety guard check. */
export interface GuardResult {
  ok: boolean;
  /** When !ok, a safe spoken deflection to return instead of the real answer. */
  deflection?: string;
  /** Why it tripped — logged, never spoken. */
  reason?: GuardReason;
}

/** One recorded turn (admin turn log). The question text is dropped for guard trips. */
export interface TurnRecord {
  id: string;
  createdAt: string;
  updatedAt: string;
  prospect: string;
  conversation_id?: string;
  /** Redacted for unsafe/guard-tripped inputs. */
  question?: string;
  total: number;
  first_token: number;
  retrieve: number;
  citations: number;
  handoff: boolean;
  guard_trip: boolean;
  reason?: string;
  source: "voice-answer" | "golden-eval";
}
