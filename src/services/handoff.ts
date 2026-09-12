/**
 * Deterministic handoff detection.
 *
 * This is a CONTRACT with the voice-answer prompt (docs/developer/examples.md), not a fuzzy
 * heuristic. The prompt is instructed to begin any unanswerable reply with a fixed sentinel;
 * the bridge keys `handoff` off that exact prefix.
 *
 * Belt-and-braces: an empty/ungrounded ARAG response (no answer text, no retrieval) is ALSO
 * treated as a handoff, so a model that ignores the sentinel still degrades safely.
 */
import type { HandoffReason } from "../types.ts";

/** Must stay identical to the sentinel in the voice prompt. */
export const HANDOFF_SENTINEL = "HANDOFF:";

export interface HandoffDecision {
  handoff: boolean;
  /** Why — for logging/metrics, never spoken. */
  reason?: HandoffReason;
}

/**
 * ARAG's stock "no answer" phrasings, in case a turn ever runs without the voice prompt
 * (e.g. a stored config that omits it) and the model emits its default refusal instead of the
 * sentinel. Conservative prefixes only, to avoid false handoffs on real answers.
 */
const NOT_FOUND_PREFIXES = [
  "not enough data to answer",
  "i don't have enough",
  "i do not have enough",
  "i couldn't find",
  "i could not find",
];

/**
 * Decide whether this turn must hand off to a human.
 *
 * @param answerText the raw answer text assembled from ARAG's chunks (pre voice-shaping)
 * @param retrievalCount number of retrieval items ARAG returned
 */
export function decideHandoff(answerText: string, retrievalCount: number): HandoffDecision {
  const trimmed = (answerText ?? "").trim();

  // 1. Explicit sentinel from the prompt — the primary, deterministic path.
  if (trimmed.toUpperCase().startsWith(HANDOFF_SENTINEL)) return { handoff: true, reason: "sentinel" };

  // 1b. Belt-and-braces: ARAG's stock refusal phrasings (only if the prompt wasn't applied).
  const lower = trimmed.toLowerCase();
  if (NOT_FOUND_PREFIXES.some((p) => lower.startsWith(p))) {
    return { handoff: true, reason: "not-found-phrase" };
  }

  // 2. No grounded content at all → can't have answered.
  if (trimmed.length === 0) return { handoff: true, reason: "empty-answer" };

  // 3. Nothing retrieved → answer (if any) is ungrounded; refuse rather than risk it.
  if (retrievalCount === 0) return { handoff: true, reason: "no-retrieval" };

  return { handoff: false };
}

/**
 * Strip the sentinel prefix from text (used only if we ever surface the model's own handoff
 * line; normally the bridge substitutes the prospect's configured handoff_msg).
 */
export function stripSentinel(text: string): string {
  const trimmed = (text ?? "").trim();
  if (trimmed.toUpperCase().startsWith(HANDOFF_SENTINEL)) {
    return trimmed.slice(HANDOFF_SENTINEL.length).trim();
  }
  return trimmed;
}
