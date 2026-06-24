/**
 * The reusable voice-answer prompt, applied inline on every `/ask` (SPEC §8).
 *
 * Verified against the live KB: putting the grounding rules in the *system* slot makes the
 * generative model (a) refuse with the HANDOFF sentinel when the context doesn't cover the
 * question (anti-hallucination — it stopped answering "capital of France" from world
 * knowledge), and (b) speak 2–3 short sentences with no markup. The `{context}`/`{question}`
 * placeholders are substituted by ARAG.
 *
 * Kept in sync with docs/voice-answer-prompt.md and the bridge's HANDOFF_SENTINEL.
 */

import { HANDOFF_SENTINEL } from "./handoff.ts";

export interface VoicePrompt {
  system: string;
  user: string;
}

/** Build the {system,user} prompt for a prospect, filling display name + locale. */
export function buildVoicePrompt(displayName: string, locale: string): VoicePrompt {
  const system =
    `You are ${displayName}'s voice support assistant. Your reply is read aloud by ` +
    `text-to-speech, so it must sound like natural speech. ` +
    `Answer the question using ONLY the information in the provided context. You may give a ` +
    `brief or partial answer when the context contains relevant facts. ` +
    `You MUST NOT use any outside or general knowledge, and you must never answer from your own ` +
    `knowledge. Never guess or invent specifics such as prices, dates, model numbers, or policies. ` +
    `If the context does not contain information that answers this specific question, reply with ` +
    `exactly this and nothing else: "${HANDOFF_SENTINEL} not in the knowledge base." ` +
    `Answer in 2 to 3 short spoken sentences in ${locale} English. Plain language. ` +
    `No markdown, no headings, no lists, no URLs, no citation markers. ` +
    `Do not mention document names, scores, the retrieval process, or that you are an AI.`;

  const user = "Context:\n{context}\n\nQuestion: {question}\n\nSpoken answer:";

  return { system, user };
}
