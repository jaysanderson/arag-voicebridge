/**
 * Safety guards (SPEC §6.2.2 steps 2 & 8, §10).
 *
 * Two checkpoints: an INPUT guard before ARAG and an OUTPUT guard before TTS. These are
 * deliberately lightweight, deterministic, and logged — they are a demo-grade safety net,
 * not a content-moderation product. They exist so a reviewer sees the seams where richer
 * moderation (e.g. a classifier) would slot in.
 */

import type { GuardResult } from "./types.ts";
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
const MAX_QUESTION_CHARS = 1200;

/**
 * Input guard — runs before the ARAG call.
 * Rejects empty input, over-long input, injection attempts, and clearly unsafe asks.
 */
export function guardInput(question: string): GuardResult {
  const q = (question ?? "").trim();

  if (q.length === 0) {
    return { ok: false, deflection: SAFE_INPUT_DEFLECTION, reason: "empty-question" };
  }
  if (q.length > MAX_QUESTION_CHARS) {
    return { ok: false, deflection: SAFE_INPUT_DEFLECTION, reason: "question-too-long" };
  }
  for (const re of INJECTION_PATTERNS) {
    if (re.test(q)) {
      return { ok: false, deflection: SAFE_INPUT_DEFLECTION, reason: "prompt-injection" };
    }
  }
  for (const re of OUT_OF_SCOPE_PATTERNS) {
    if (re.test(q)) {
      return { ok: false, deflection: SAFE_INPUT_DEFLECTION, reason: "unsafe-request" };
    }
  }
  return { ok: true };
}

/**
 * Output guard — runs on the already voice-shaped answer, just before TTS.
 * Last line of defence: if a URL/marker/markdown still leaked through shaping, don't
 * speak it — deflect. Logged so we can tighten shaping if this ever trips.
 */
export function guardOutput(spokenText: string): GuardResult {
  const t = (spokenText ?? "").trim();
  if (t.length === 0) {
    return { ok: false, deflection: SAFE_OUTPUT_DEFLECTION, reason: "empty-output" };
  }
  if (hasSpeakableViolation(t)) {
    return { ok: false, deflection: SAFE_OUTPUT_DEFLECTION, reason: "unspeakable-content" };
  }
  return { ok: true };
}
