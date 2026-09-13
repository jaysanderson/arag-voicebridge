/**
 * The turn pipeline — nine ordered steps for one voice turn.
 *
 *   1 resolve prospect (caller)      6 extract citations (data only, never spoken)
 *   2 input safety guard             7 deterministic handoff decision
 *   3 build the ARAG request         8 output safety guard
 *   4 call ARAG (streamed)           9 return + record metrics
 *   5 shape the answer for voice
 *
 * Every failure path degrades to a spoken handoff line, so the agent never gets dead air. The
 * ARAG client is injected (structurally typed) so the pipeline is unit-testable without a KB.
 */
import type { AskRequest, AskResult, ChatContext, Logger } from "../../vendor/arag-platform/src/index.ts";
import type { VoiceConfig } from "../config.ts";
import type {
  GuardReason,
  HandoffReason,
  HistoryTurn,
  ProspectConfig,
  VoiceAnswerRequest,
  VoiceAnswerResponse,
} from "../types.ts";
import { citationsFrom } from "./citations.ts";
import { decideHandoff } from "./handoff.ts";
import { guardInput, guardOutput, screenTurns } from "./safety.ts";
import { buildVoicePrompt } from "./voicePrompt.ts";
import { shapeForVoice } from "./voiceShape.ts";

/** The slice of the ARAG client the pipeline needs (structural: easy to stub in tests). */
export interface AskCapable {
  ask(body: AskRequest, opts?: { signal?: AbortSignal; timeoutMs?: number }): Promise<AskResult>;
}

/** The deployment-wide ARAG answering defaults, which a prospect may override. */
export interface AragDefaults {
  /** Empty = the Knowledge Box's own default model. */
  generativeModel: string;
  /** "predict" | "noop". */
  reranker: string;
}

export interface TurnDeps {
  /** Resolves the ARAG client for a prospect (see AragClientPool). */
  clientFor: (p: ProspectConfig) => AskCapable;
  voice: VoiceConfig;
  /** Read per turn, not captured, so Settings → Connection is not inert. */
  aragDefaults?: () => AragDefaults;
  log: Logger;
}

/** Spoken line when ARAG is slow/erroring — never dead air. */
export const DEGRADE_LINE = "Sorry, I'm having trouble reaching that information right now.";

const GUARD_REASONS = new Set<string>([
  "empty-question",
  "question-too-long",
  "prompt-injection",
  "unsafe-request",
  "empty-output",
  "unspeakable-content",
]);

/** Did this turn end because a safety guard tripped (rather than a normal handoff)? */
export function isGuardReason(reason: string | undefined): boolean {
  return reason !== undefined && GUARD_REASONS.has(reason);
}

/**
 * Clamp history to the last N turns (a turn = USER+NUCLIA pair ≈ 2 messages) to bound
 * generation latency and cost, and coerce to ARAG's `context` shape.
 */
export function buildContext(history: HistoryTurn[] | undefined, maxTurns: number): ChatContext[] {
  if (!history || history.length === 0) return [];
  const maxMessages = Math.max(0, maxTurns) * 2;
  const recent = history
    .slice(-maxMessages)
    .filter((h) => h && typeof h.text === "string" && h.text.trim().length > 0);
  // History is caller-supplied and reaches the model as context, so it is screened exactly like
  // the question; a poisoned turn is dropped rather than forwarded.
  const { kept } = screenTurns(recent);
  return kept.map(
    (h) => ({ author: h.author === "NUCLIA" ? "NUCLIA" : "USER", text: h.text.trim() }) as ChatContext,
  );
}

/** Build the ARAG `/ask` body for a turn (exported for tests and the docs). */
export function buildAskRequest(
  req: VoiceAnswerRequest,
  prospect: ProspectConfig,
  voice: VoiceConfig,
  defaults: AragDefaults | undefined = undefined,
): AskRequest {
  const body: AskRequest = {
    query: req.question.trim(),
    context: buildContext(req.history, voice.maxHistoryTurns),
    // `relations` is excluded for speed; never add it unless a demo needs NER/graph.
    features: ["semantic", "keyword"],
    citations: true,
  };
  if (prospect.ask_config) {
    // Stored configuration path: the config owns prompt, filters and models.
    body.search_configuration = prospect.ask_config;
    return body;
  }
  // Inline path: the grounding voice prompt plus the latency levers.
  body.prompt = buildVoicePrompt(prospect.display_name, prospect.locale);
  // The prospect wins, then the deployment's own default (Settings → Connection), then "noop" —
  // the lowest-latency choice, which is what a voice turn wants when nobody has said otherwise.
  body.reranker = prospect.reranker ?? defaults?.reranker ?? "noop";
  body.max_tokens = prospect.max_tokens ?? 160;
  // Temperature 0 → deterministic answers/handoffs, so the golden set is repeatable.
  body.temperature = prospect.temperature ?? 0;
  const model = req.generative_model || prospect.generative_model || defaults?.generativeModel;
  if (model) body.generative_model = model;
  return body;
}

export interface TurnOutcome {
  response: VoiceAnswerResponse;
  /** True when a safety guard produced the response. */
  guardTrip: boolean;
}

/**
 * One recorded step of the pipeline.
 *
 * The nine steps are the product's explanation of itself — "grounded, cited and governed" is a
 * claim until you can watch the guards fire and the handoff decision land. The Ask tester renders
 * these as a stepper, so a stranger can see *why* a turn handed off rather than only that it did.
 */
export interface PipelineStep {
  step: number;
  id: string;
  label: string;
  status: "ok" | "skipped" | "tripped" | "handoff" | "error";
  ms: number;
  detail?: string;
}

/** Collects the steps of one turn. Passing none costs nothing — tracing is opt-in per request. */
export class TurnTrace {
  readonly steps: PipelineStep[] = [];
  private readonly t0 = performance.now();
  private n = 0;

  add(id: string, label: string, status: PipelineStep["status"], detail?: string): void {
    this.n += 1;
    this.steps.push({
      step: this.n,
      id,
      label,
      status,
      ms: Math.round(performance.now() - this.t0),
      detail,
    });
  }
}

/** Run one turn. Always resolves — failures become a graceful handoff. */
export async function runTurn(
  req: VoiceAnswerRequest,
  prospect: ProspectConfig,
  deps: TurnDeps,
  opts: { signal?: AbortSignal; trace?: TurnTrace } = {},
): Promise<TurnOutcome> {
  const t0 = performance.now();
  const trace = opts.trace;
  trace?.add("resolve", "Resolve prospect", "ok", `${prospect.display_name} · ${prospect.locale}`);
  const latency = (firstToken = 0, retrieve = 0) => ({
    retrieve: Math.round(retrieve),
    first_token: Math.round(firstToken),
    total: Math.round(performance.now() - t0),
  });
  const finish = (
    answer: string,
    reason: HandoffReason | GuardReason | undefined,
    lat: ReturnType<typeof latency>,
    citations: VoiceAnswerResponse["citations"] = [],
    handoff = true,
  ): TurnOutcome => ({
    response: { answer, citations, handoff, latency_ms: lat, handoff_reason: reason },
    guardTrip: isGuardReason(reason),
  });

  // Step 2 — input safety guard (before ARAG, so unsafe text is never forwarded or stored).
  const inGuard = guardInput(req.question);
  trace?.add(
    "guard-input",
    "Input safety guard",
    inGuard.ok ? "ok" : "tripped",
    inGuard.ok ? "question passed" : `blocked: ${inGuard.reason}`,
  );
  if (!inGuard.ok) {
    deps.log.warn("guard.input.trip", {
      prospect: req.prospect,
      reason: inGuard.reason,
      conversation_id: req.conversation_id,
    });
    return finish(inGuard.deflection ?? DEGRADE_LINE, inGuard.reason, latency());
  }

  // Step 3 — build the ARAG request.
  const body = buildAskRequest(req, prospect, deps.voice, deps.aragDefaults?.());
  trace?.add(
    "build-request",
    "Build the ARAG request",
    "ok",
    prospect.ask_config
      ? `stored configuration "${prospect.ask_config}"`
      : `inline prompt · reranker ${body.reranker} · ${body.max_tokens} tokens`,
  );

  // Step 4 — call ARAG. Failures → graceful handoff.
  let result: AskResult;
  try {
    result = await deps.clientFor(prospect).ask(body, {
      signal: opts.signal,
      timeoutMs: deps.voice.turnTimeoutMs,
    });
  } catch (err) {
    const e = err as { kind?: string; message?: string };
    deps.log.error("arag.fail", {
      prospect: req.prospect,
      kind: e.kind ?? "network",
      message: e.message,
      conversation_id: req.conversation_id,
    });
    trace?.add("ask", "Ask the Knowledge Box", "error", e.message ?? "upstream error");
    return finish(prospect.handoff_msg || DEGRADE_LINE, "upstream-error", latency());
  }

  const citations = citationsFrom(result.retrieval);
  const retrievalCount = Object.keys(result.retrieval?.resources ?? {}).length;
  const lat = latency(result.timings.firstTokenMs, result.timings.retrieveMs);
  trace?.add(
    "ask",
    "Ask the Knowledge Box",
    "ok",
    `${retrievalCount} resource${retrievalCount === 1 ? "" : "s"} retrieved · first token ${Math.round(
      result.timings.firstTokenMs,
    )} ms`,
  );
  trace?.add(
    "citations",
    "Extract citations",
    citations.length ? "ok" : "skipped",
    citations.length ? citations.map((c) => c.title).join(", ") : "no cited source",
  );

  // Step 7 — deterministic handoff (sentinel | stock refusal | empty | no retrieval).
  const handoff = decideHandoff(result.answerText, retrievalCount);
  trace?.add(
    "handoff",
    "Handoff decision",
    handoff.handoff ? "handoff" : "ok",
    handoff.handoff ? `hand off: ${handoff.reason}` : "answer is grounded — speak it",
  );
  if (handoff.handoff) {
    deps.log.info("turn.handoff", {
      prospect: req.prospect,
      reason: handoff.reason,
      conversation_id: req.conversation_id,
      ...lat,
    });
    return finish(prospect.handoff_msg, handoff.reason, lat);
  }

  // Step 5 — shape for voice (≤3 sentences, no URLs/markdown/markers).
  const spoken = shapeForVoice(result.answerText);
  const sentences = spoken.split(/(?<=[.!?])\s+/).filter(Boolean).length;
  trace?.add(
    "shape",
    "Shape for voice",
    "ok",
    `${sentences} sentence${sentences === 1 ? "" : "s"}, no markup or URLs`,
  );

  // Step 8 — output safety guard (before TTS).
  const outGuard = guardOutput(spoken);
  trace?.add(
    "guard-output",
    "Output safety guard",
    outGuard.ok ? "ok" : "tripped",
    outGuard.ok ? "line is speakable" : `blocked: ${outGuard.reason}`,
  );
  if (!outGuard.ok) {
    deps.log.warn("guard.output.trip", {
      prospect: req.prospect,
      reason: outGuard.reason,
      conversation_id: req.conversation_id,
    });
    return finish(outGuard.deflection ?? DEGRADE_LINE, outGuard.reason, lat, citations);
  }

  // Step 9 — success.
  deps.log.info("turn.ok", {
    prospect: req.prospect,
    conversation_id: req.conversation_id,
    citations: citations.length,
    handoff: false,
    ...lat,
  });
  return finish(spoken, undefined, lat, citations, false);
}
