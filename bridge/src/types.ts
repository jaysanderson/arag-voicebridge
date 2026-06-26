/**
 * Shared types for the ask-bridge service.
 *
 * The request/response contracts here mirror docs/SPEC.md §6.2.1. The ARAG-facing
 * shapes (NDJSON items) are isolated in arag.ts because field-name drift against the
 * live docs is the one thing to verify at M0 (SPEC §18).
 */

/** Conversation roles as ARAG expects them in `context`. */
export type Author = "USER" | "NUCLIA";

/** One prior turn of conversation, forwarded to ARAG as context. */
export interface HistoryTurn {
  author: Author;
  text: string;
}

/** Request body from the ElevenAgent custom server tool. */
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

/** Response body returned to the ElevenAgent tool. */
export interface VoiceAnswerResponse {
  answer: string;
  citations: Citation[];
  handoff: boolean;
  latency_ms: LatencyMs;
}

/** A single prospect entry in the config registry (SPEC §6.4). */
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
  /** Non-secret ElevenAgents identifiers (used by the client, not the bridge). */
  agent_id?: string;
  voice_id?: string;
  /** HeyGen/LiveAvatar avatar id for this prospect's video avatar (LiveAvatar pane). */
  avatar_id?: string;
  locale: string;
  greeting: string;
  handoff_msg: string;
  golden_questions?: GoldenQuestion[];
}

/** The registry is a map of prospect key → config. */
export type Registry = Record<string, ProspectConfig>;

/**
 * A golden-set question. `expect` lets the harness assert behaviour, not just
 * "didn't crash" (SPEC §13): "answer" must be grounded; "handoff" must escalate.
 */
export interface GoldenQuestion {
  q: string;
  expect: "answer" | "handoff";
  /** Optional substrings the spoken answer should contain (case-insensitive). */
  must_include?: string[];
}

/** Where a safety guard sits in the pipeline. */
export type GuardStage = "input" | "output";

/** Result of a safety guard check. */
export interface GuardResult {
  ok: boolean;
  /** When !ok, a safe spoken deflection to return instead of the real answer. */
  deflection?: string;
  /** Why it tripped — logged, never spoken. */
  reason?: string;
}
