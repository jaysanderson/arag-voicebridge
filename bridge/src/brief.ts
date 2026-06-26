/**
 * Structured "live call brief" — used by the ambient Listen mode.
 *
 * Instead of a text blob, we pass an `answer_json_schema` to ARAG `/ask` so the answer comes
 * back as a well-structured object (ARAG's `answer_json`). It is an EVOLVING brief: each refresh
 * receives the running conversation transcript and the previous brief, so it builds up a persona
 * of the call and of the person being spoken to, infers what they want, and suggests questions to
 * ask and answers to give. Product facts stay grounded in the knowledge base; the persona/intent
 * reasoning is over the conversation.
 */

import type { ProspectConfig, Citation } from "./types.ts";
import type { AskParams, AskResult } from "./arag.ts";
import { askArag, AragError } from "./arag.ts";
import { config } from "./config.ts";
import { log } from "./logger.ts";
import { guardInput } from "./safety.ts";
import { extractCitations } from "./citations.ts";
import { buildContext } from "./pipeline.ts";

/** OpenAI-function-style schema ARAG expects in `answer_json_schema`. */
export const LIVE_BRIEF_SCHEMA = {
  name: "call_brief",
  description:
    "An evolving, structured brief for someone handling a live conversation: who the other " +
    "person is, what they want, where the conversation is, the most relevant knowledge, and the " +
    "best questions to ask and answers to give to move them forward.",
  parameters: {
    type: "object",
    properties: {
      topic: {
        type: "string",
        description: "The current subject being discussed, in 3 to 6 words.",
      },
      caller_profile: {
        type: "string",
        description:
          "What can be inferred about the OTHER person from the conversation so far — their role, " +
          "situation, and level of knowledge. One or two sentences. Empty if not yet clear.",
      },
      their_goal: {
        type: "string",
        description:
          "Your best inference of the underlying outcome the other person wants. One sentence.",
      },
      stage: {
        type: "string",
        description:
          "Where the conversation is right now: e.g. exploring, evaluating, objection, ready, " +
          "off-topic. One or two words.",
      },
      summary: {
        type: "string",
        description:
          "One or two sentences on the current state of the conversation and the most relevant " +
          "information right now, grounded in the knowledge base.",
      },
      key_points: {
        type: "array",
        items: { type: "string" },
        description:
          "2 to 5 short factual bullets drawn ONLY from the knowledge base that matter right now.",
      },
      suggested_questions: {
        type: "array",
        items: { type: "string" },
        description:
          "1 to 3 questions the handler could ASK the other person to qualify them or move them " +
          "toward their goal.",
      },
      suggested_answers: {
        type: "array",
        items: { type: "string" },
        description:
          "1 to 3 things the handler could SAY, grounded ONLY in the knowledge base, to address " +
          "the other person's need.",
      },
    },
    required: ["summary"],
  },
} as const;

function briefSystemPrompt(displayName: string, locale: string): string {
  return (
    `You are a real-time call copilot for someone (the handler) in a live conversation related ` +
    `to ${displayName}. Across the whole call you maintain ONE evolving brief. ` +
    `Infer caller_profile (who the OTHER person is), their_goal (the outcome they want), and ` +
    `stage from the CONVERSATION so far — these are reasoning, not product facts. ` +
    `Draw key_points and suggested_answers ONLY from the provided knowledge-base context; never ` +
    `invent product facts, prices, model numbers, or policies — if the knowledge base lacks it, ` +
    `leave it out. suggested_questions are questions the handler could ask the other person to ` +
    `qualify them or advance toward their goal. ` +
    `Refine and EXTEND your previous brief each time; do not restart from scratch. Keep every ` +
    `field concise and written in ${locale} English.`
  );
}

export interface BriefRequest {
  text: string;
  /** Accumulated conversation transcript so far (most recent last). */
  transcript?: string;
  /** The previous brief object, so the model refines rather than restarts. */
  prev?: unknown;
  schema?: unknown;
  model?: string;
}

/** Render a previous brief object as brace-free "Label: value" lines for the prompt. */
function prevBriefToText(prev: unknown): string {
  if (!prev || typeof prev !== "object") return "";
  const o = prev as Record<string, unknown>;
  const lines: string[] = [];
  const str = (label: string, v: unknown) => {
    if (typeof v === "string" && v.trim()) lines.push(`${label}: ${v.trim()}`);
  };
  const arr = (label: string, v: unknown) => {
    if (Array.isArray(v)) {
      const items = v.filter((x) => x && String(x).trim()).map((x) => String(x).trim());
      if (items.length) lines.push(`${label}: ${items.join("; ")}`);
    }
  };
  str("Topic", o.topic);
  str("Caller profile", o.caller_profile);
  str("Their goal", o.their_goal);
  str("Stage", o.stage);
  str("Summary", o.summary);
  arr("Key points", o.key_points);
  arr("Suggested questions", o.suggested_questions);
  arr("Suggested answers", o.suggested_answers);
  return lines.join("\n");
}

export interface BriefResult {
  brief: unknown | null;
  citations: Citation[];
  latency_ms: { retrieve: number; first_token: number; total: number };
}

const MAX_TRANSCRIPT_CHARS = 6000;
const MAX_PREV_CHARS = 2000;

/**
 * Run one structured-brief lookup. Never throws — on any failure returns brief:null so the
 * client keeps the previous brief on screen.
 */
export async function runBrief(
  req: BriefRequest,
  prospect: ProspectConfig,
  signal?: AbortSignal,
): Promise<BriefResult> {
  const t0 = performance.now();
  const latency = (ft = 0, rt = 0) => ({
    retrieve: Math.round(rt),
    first_token: Math.round(ft),
    total: Math.round(performance.now() - t0),
  });

  const guard = guardInput(req.text);
  if (!guard.ok) return { brief: null, citations: [], latency_ms: latency() };

  // ARAG's prompt templater only allows {context}/{question}; any other curly braces 400.
  // So strip braces from injected text and render the previous brief as brace-free lines.
  const stripBraces = (s: string) => s.replace(/[{}]/g, "");
  const transcript = stripBraces((req.transcript ?? "").slice(-MAX_TRANSCRIPT_CHARS));
  const prevText = req.prev ? stripBraces(prevBriefToText(req.prev)).slice(0, MAX_PREV_CHARS) : "";
  const user =
    "Knowledge base context:\n{context}\n\n" +
    (transcript ? `Conversation so far (most recent last):\n${transcript}\n\n` : "") +
    (prevText ? `Your brief so far — refine and extend it, do not restart:\n${prevText}\n\n` : "") +
    "Most recent words from the conversation: {question}\n\nReturn the updated brief.";

  const askParams: AskParams = {
    kbId: prospect.kb_id,
    region: prospect.region || config.aragRegionDefault,
    // Retrieval is focused on the latest words (the current topic); the conversation arc lives
    // in the prompt above so the model reasons over the whole call.
    query: req.text.trim(),
    context: buildContext([], config.maxHistoryTurns),
    prompt: { system: briefSystemPrompt(prospect.display_name, prospect.locale), user },
    reranker: prospect.reranker ?? "predict",
    maxTokens: 600,
    temperature: prospect.temperature ?? 0,
    answerJsonSchema: req.schema ?? LIVE_BRIEF_SCHEMA,
  };
  // The brief MUST be fast: a per-request model wins, else the prospect's fast brief_model,
  // else its answer model. Slow models (e.g. Claude) don't return answer_json before the
  // timeout → null briefs that never update, which is exactly what we're avoiding here.
  const m = req.model || prospect.brief_model || prospect.generative_model;
  if (m) askParams.generativeModel = m;

  let result: AskResult;
  try {
    result = await askArag(askParams, signal);
  } catch (err) {
    const kind = err instanceof AragError ? err.kind : "network";
    log.warn("brief.fail", { prospect: prospect.display_name, kind, message: (err as Error).message });
    return { brief: null, citations: [], latency_ms: latency() };
  }

  let brief: unknown | null = result.answerJson ?? null;
  if (!brief && result.answerText) {
    try {
      brief = JSON.parse(result.answerText);
    } catch {
      brief = null;
    }
  }
  return {
    brief,
    citations: extractCitations(result.retrieval),
    latency_ms: latency(result.firstTokenMs, result.retrieveMs),
  };
}
