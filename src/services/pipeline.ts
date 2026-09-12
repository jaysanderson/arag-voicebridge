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
import { guardInput, guardOutput } from "./safety.ts";
import { buildVoicePrompt } from "./voicePrompt.ts";
import { shapeForVoice } from "./voiceShape.ts";

/** The slice of the ARAG client the pipeline needs (structural: easy to stub in tests). */
export interface AskCapable {
  ask(body: AskRequest, opts?: { signal?: AbortSignal; timeoutMs?: number }): Promise<AskResult>;
}

export interface TurnDeps {
  /** Resolves the ARAG client for a prospect (see AragClientPool). */
  clientFor: (p: ProspectConfig) => AskCapable;
  voice: VoiceConfig;
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
  return history
    .slice(-maxMessages)
    .filter((h) => h && typeof h.text === "string" && h.text.trim().length > 0)
    .map((h) => ({ author: h.author === "NUCLIA" ? "NUCLIA" : "USER", text: h.text.trim() }) as ChatContext);
}

/** Build the ARAG `/ask` body for a turn (exported for tests and the docs). */
export function buildAskRequest(
  req: VoiceAnswerRequest,
  prospect: ProspectConfig,
  voice: VoiceConfig,
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
  body.reranker = prospect.reranker ?? "noop";
  body.max_tokens = prospect.max_tokens ?? 160;
  // Temperature 0 → deterministic answers/handoffs, so the golden set is repeatable.
  body.temperature = prospect.temperature ?? 0;
  const model = req.generative_model || prospect.generative_model;
  if (model) body.generative_model = model;
  return body;
}

export interface TurnOutcome {
  response: VoiceAnswerResponse;
  /** True when a safety guard produced the response. */
  guardTrip: boolean;
}

/** Run one turn. Always resolves — failures become a graceful handoff. */
export async function runTurn(
  req: VoiceAnswerRequest,
  prospect: ProspectConfig,
  deps: TurnDeps,
  opts: { signal?: AbortSignal } = {},
): Promise<TurnOutcome> {
  const t0 = performance.now();
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
  if (!inGuard.ok) {
    deps.log.warn("guard.input.trip", {
      prospect: req.prospect,
      reason: inGuard.reason,
      conversation_id: req.conversation_id,
    });
    return finish(inGuard.deflection ?? DEGRADE_LINE, inGuard.reason, latency());
  }

  // Step 3 — build the ARAG request.
  const body = buildAskRequest(req, prospect, deps.voice);

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
    return finish(prospect.handoff_msg || DEGRADE_LINE, "upstream-error", latency());
  }

  const citations = citationsFrom(result.retrieval);
  const retrievalCount = Object.keys(result.retrieval?.resources ?? {}).length;
  const lat = latency(result.timings.firstTokenMs, result.timings.retrieveMs);

  // Step 7 — deterministic handoff (sentinel | stock refusal | empty | no retrieval).
  const handoff = decideHandoff(result.answerText, retrievalCount);
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

  // Step 8 — output safety guard (before TTS).
  const outGuard = guardOutput(spoken);
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
