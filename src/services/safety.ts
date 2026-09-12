/**
 * Safety guards: an INPUT guard before ARAG and an OUTPUT guard before TTS.
 *
 * These are deliberately lightweight, deterministic and logged — a demo-grade safety net, not a
 * content-moderation product. They exist so the seams where richer moderation (a classifier, a
 * policy service) would slot in are obvious: see docs/developer/extension-points.md.
 */
import type { GuardReason, GuardResult } from "../types.ts";
import { hasSpeakableViolation } from "./voiceShape.ts";

/** Obvious prompt-injection / jailbreak phrasings we refuse to forward to ARAG. */
const INJECTION_PATTERNS: RegExp[] = [
  /ignore (?:all |the )?(?:previous|prior|above) instructions/i,
  /disregard (?:your|the) (?:system )?prompt/i,
  /reveal (?:your|the) (?:system )?prompt/i,
  /you are now /i,
  /pretend to be /i,
];

/** Categories the demo agent should never attempt — deflect to a human. */
const OUT_OF_SCOPE_PATTERNS: RegExp[] = [
  /\b(kill|harm|hurt)\s+(myself|yourself|someone)\b/i,
  /\bhow (?:do|to) (?:i )?make (?:a )?(?:bomb|weapon|explosive)\b/i,
];

const SAFE_INPUT_DEFLECTION =
  "I can only help with support questions about this service. Let me get a team member for anything else.";

const SAFE_OUTPUT_DEFLECTION =
  "I'm not able to help with that one — let me put you through to someone who can.";

/** Maximum question length we forward (bounds cost and blocks dump attacks). */
export const MAX_QUESTION_CHARS = 1200;

/**
 * Does this text look like an injection attempt or an unsafe ask? Shared by the input guard and
 * by the screening of caller-supplied history/transcripts, which reach the model as context and
 * would otherwise be an unguarded side door into the prompt.
 */
export function unsafeReason(text: string): GuardReason | null {
  const q = (text ?? "").trim();
  if (q.length === 0) return null;
  for (const re of INJECTION_PATTERNS) if (re.test(q)) return "prompt-injection";
  for (const re of OUT_OF_SCOPE_PATTERNS) if (re.test(q)) return "unsafe-request";
  return null;
}

/**
 * Drop conversation turns whose text looks like an injection attempt. History is supplied by the
 * caller, so it is exactly as untrusted as the question itself; dropping is preferred to
 * rejecting the turn so a poisoned transcript degrades the context instead of killing the call.
 */
export function screenTurns<T extends { text: string }>(turns: T[]): { kept: T[]; dropped: number } {
  const kept = turns.filter((t) => unsafeReason(t.text) === null);
  return { kept, dropped: turns.length - kept.length };
}

/** Remove injected lines from a free-text transcript, keeping the rest of the conversation. */
export function screenTranscript(text: string): { text: string; dropped: number } {
  const lines = (text ?? "").split(/\r?\n/);
  const kept = lines.filter((l) => unsafeReason(l) === null);
  return { text: kept.join("\n"), dropped: lines.length - kept.length };
}

/**
 * Input guard — runs before the ARAG call. Rejects empty input, over-long input, injection
 * attempts, and clearly unsafe asks.
 */
export function guardInput(question: string): GuardResult {
  const q = (question ?? "").trim();
  if (q.length === 0) return { ok: false, deflection: SAFE_INPUT_DEFLECTION, reason: "empty-question" };
  if (q.length > MAX_QUESTION_CHARS) {
    return { ok: false, deflection: SAFE_INPUT_DEFLECTION, reason: "question-too-long" };
  }
  const unsafe = unsafeReason(q);
  if (unsafe) return { ok: false, deflection: SAFE_INPUT_DEFLECTION, reason: unsafe };
  return { ok: true };
}

/**
 * Output guard — runs on the already voice-shaped answer, just before TTS. Last line of
 * defence: if a URL/marker/markdown still leaked through shaping, don't speak it — deflect.
 */
export function guardOutput(spokenText: string): GuardResult {
  const t = (spokenText ?? "").trim();
  if (t.length === 0) return { ok: false, deflection: SAFE_OUTPUT_DEFLECTION, reason: "empty-output" };
  if (hasSpeakableViolation(t)) {
    return { ok: false, deflection: SAFE_OUTPUT_DEFLECTION, reason: "unspeakable-content" };
  }
  return { ok: true };
}
