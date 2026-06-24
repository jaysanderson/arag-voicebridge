/**
 * The ask-bridge turn pipeline (SPEC §6.2.2).
 *
 * Runs the nine ordered steps for one voice turn and returns the VoiceAnswerResponse.
 * The ARAG call is injectable (`deps.ask`) so the pipeline is unit-testable without a
 * live KB — the server wires in the real askArag().
 */

import type {
  VoiceAnswerRequest,
  VoiceAnswerResponse,
  ProspectConfig,
  HistoryTurn,
} from "./types.ts";
import type { AskParams, AskResult } from "./arag.ts";
import { askArag, AragError } from "./arag.ts";
import { config } from "./config.ts";
import { log } from "./logger.ts";
import { guardInput, guardOutput } from "./safety.ts";
import { shapeForVoice } from "./voiceShape.ts";
import { extractCitations } from "./citations.ts";
import { decideHandoff } from "./handoff.ts";
import { buildVoicePrompt } from "./voicePrompt.ts";

export interface PipelineDeps {
  /** Injectable ARAG caller (defaults to the real client). */
  ask: (params: AskParams, signal?: AbortSignal) => Promise<AskResult>;
}

const defaultDeps: PipelineDeps = { ask: askArag };

/** Spoken line when ARAG is slow/erroring — never dead air (SPEC §6.2.3). */
const DEGRADE_LINE = "Sorry, I'm having trouble reaching that information right now.";

/**
 * Clamp history to the last N turns (a turn = USER+NUCLIA pair ≈ 2 messages) to bound
 * generation latency/cost (SPEC §7.2, §9.7), and coerce to ARAG's context shape.
 */
export function buildContext(history: HistoryTurn[] | undefined, maxTurns: number): HistoryTurn[] {
  if (!history || history.length === 0) return [];
  const maxMessages = Math.max(0, maxTurns) * 2;
  const recent = history.slice(-maxMessages);
  return recent
    .filter((h) => h && typeof h.text === "string" && h.text.trim().length > 0)
    .map((h) => ({ author: h.author === "NUCLIA" ? "NUCLIA" : "USER", text: h.text.trim() }));
}

/**
 * Run one turn. Always resolves to a VoiceAnswerResponse — every failure path degrades to a
 * handoff with a spoken line, so the agent never stalls.
 *
 * @param signal optional AbortSignal for barge-in cancellation (SPEC §7.4).
 */
export async function runTurn(
  req: VoiceAnswerRequest,
  prospect: ProspectConfig,
  signal?: AbortSignal,
  deps: PipelineDeps = defaultDeps,
): Promise<VoiceAnswerResponse> {
  const t0 = performance.now();
  const safeLatency = (firstToken = 0, retrieve = 0) => ({
    retrieve: Math.round(retrieve),
    first_token: Math.round(firstToken),
    total: Math.round(performance.now() - t0),
  });

  // Step 2 — input safety guard (before ARAG).
  const inGuard = guardInput(req.question);
  if (!inGuard.ok) {
    log.warn("guard.input.trip", {
      prospect: req.prospect,
      reason: inGuard.reason,
      conversation_id: req.conversation_id,
    });
    return {
      answer: inGuard.deflection ?? DEGRADE_LINE,
      citations: [],
      handoff: true,
      latency_ms: safeLatency(),
    };
  }

  // Step 3 — build ARAG request (region default applied here).
  const region = prospect.region || config.aragRegionDefault;
  const askParams: AskParams = {
    kbId: prospect.kb_id,
    region,
    query: req.question.trim(),
    context: buildContext(req.history, config.maxHistoryTurns),
  };
  if (prospect.ask_config) {
    // Stored config path (SPEC §6.3.2) — the config owns prompt/filters/models.
    askParams.searchConfiguration = prospect.ask_config;
  } else {
    // Inline path (verified against the live KB): the grounding voice prompt + latency levers.
    askParams.prompt = buildVoicePrompt(prospect.display_name, prospect.locale);
    askParams.reranker = prospect.reranker ?? "noop";
    askParams.maxTokens = prospect.max_tokens ?? 160;
    // Default temperature 0 → deterministic answers/handoffs, so the golden set is repeatable.
    askParams.temperature = prospect.temperature ?? 0;
    if (prospect.generative_model) askParams.generativeModel = prospect.generative_model;
  }

  // Step 4 — call ARAG and stream. Failures → graceful handoff (SPEC §6.2.3).
  let result: AskResult;
  try {
    result = await deps.ask(askParams, signal);
  } catch (err) {
    const kind = err instanceof AragError ? err.kind : "network";
    log.error("arag.fail", {
      prospect: req.prospect,
      kind,
      message: (err as Error).message,
      conversation_id: req.conversation_id,
    });
    return {
      answer: prospect.handoff_msg || DEGRADE_LINE,
      citations: [],
      handoff: true,
      latency_ms: safeLatency(),
    };
  }

  // Step 7 — deterministic handoff (sentinel | empty | no-retrieval).
  const handoff = decideHandoff(result.answerText, result.retrieval.length);
  if (handoff.handoff) {
    log.info("turn.handoff", {
      prospect: req.prospect,
      reason: handoff.reason,
      conversation_id: req.conversation_id,
      ...safeLatency(result.firstTokenMs, result.retrieveMs),
    });
    return {
      answer: prospect.handoff_msg,
      citations: [],
      handoff: true,
      latency_ms: safeLatency(result.firstTokenMs, result.retrieveMs),
    };
  }

  // Step 5 — shape for voice (≤3 sentences, no URLs/markdown/markers).
  const spoken = shapeForVoice(result.answerText);

  // Step 6 — extract citations (data only; never spoken).
  const citations = extractCitations(result.retrieval);

  // Step 8 — output safety guard (before TTS).
  const outGuard = guardOutput(spoken);
  if (!outGuard.ok) {
    log.warn("guard.output.trip", {
      prospect: req.prospect,
      reason: outGuard.reason,
      conversation_id: req.conversation_id,
    });
    return {
      answer: outGuard.deflection ?? DEGRADE_LINE,
      citations,
      handoff: true,
      latency_ms: safeLatency(result.firstTokenMs, result.retrieveMs),
    };
  }

  // Step 9 — return + emit metrics.
  const latency = safeLatency(result.firstTokenMs, result.retrieveMs);
  log.info("turn.ok", {
    prospect: req.prospect,
    conversation_id: req.conversation_id,
    citations: citations.length,
    handoff: false,
    ...latency,
  });

  return { answer: spoken, citations, handoff: false, latency_ms: latency };
}
