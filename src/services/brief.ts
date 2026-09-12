/**
 * Structured "live call brief" — the ambient Listen mode.
 *
 * Instead of a text blob we pass an `answer_json_schema` to ARAG `/ask`, so the answer comes
 * back as a well-structured object (`answer_json`). It is an EVOLVING brief: each refresh
 * receives the running transcript and the previous brief, so it builds a persona of the call and
 * of the person being spoken to, infers what they want, and suggests questions to ask and
 * answers to give. Product facts stay grounded in the Knowledge Box; the persona/intent
 * reasoning is over the conversation.
 */
import type {
  AnswerJsonSchema,
  AskRequest,
  AskResult,
  Logger,
} from "../../vendor/arag-platform/src/index.ts";
import type { VoiceConfig } from "../config.ts";
import type { Citation, ProspectConfig } from "../types.ts";
import { citationsFrom } from "./citations.ts";
import type { AskCapable } from "./pipeline.ts";
import { guardInput, screenTranscript } from "./safety.ts";

/** OpenAI-function-style schema ARAG expects in `answer_json_schema`. */
export const LIVE_BRIEF_SCHEMA: AnswerJsonSchema = {
  name: "call_brief",
  description:
    "An evolving, structured brief for someone handling a live conversation: who the other " +
    "person is, what they want, where the conversation is, the most relevant knowledge, and the " +
    "best questions to ask and answers to give to move them forward.",
  parameters: {
    type: "object",
    properties: {
      topic: { type: "string", description: "The current subject being discussed, in 3 to 6 words." },
      caller_profile: {
        type: "string",
        description:
          "What can be inferred about the OTHER person from the conversation so far — their role, " +
          "situation, and level of knowledge. One or two sentences. Empty if not yet clear.",
      },
      their_goal: {
        type: "string",
        description: "Your best inference of the underlying outcome the other person wants. One sentence.",
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
        description: "2 to 5 short factual bullets drawn ONLY from the knowledge base that matter right now.",
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
      recommended_products: {
        type: "array",
        items: { type: "string" },
        description:
          "0 to 3 SPECIFIC products from the knowledge base to recommend when there is a genuine " +
          "fit for what the person wants — each as 'Product name — one-line why it fits'. Only " +
          "include real products named in the knowledge base; empty array if nothing clearly fits.",
      },
    },
    required: ["summary"],
  },
};

export function briefSystemPrompt(displayName: string, locale: string): string {
  return (
    `You are a real-time call copilot for someone (the handler) in a live conversation related ` +
    `to ${displayName}. Across the whole call you maintain ONE evolving brief. ` +
    `Infer caller_profile (who the OTHER person is), their_goal (the outcome they want), and ` +
    `stage from the CONVERSATION so far — these are reasoning, not product facts. ` +
    `Draw key_points and suggested_answers ONLY from the provided knowledge-base context; never ` +
    `invent product facts, prices, model numbers, or policies — if the knowledge base lacks it, ` +
    `leave it out. suggested_questions are questions the handler could ask the other person to ` +
    `qualify them or advance toward their goal. ` +
    `When the conversation reveals a need that a SPECIFIC product in the knowledge base fits, call ` +
    `it out in recommended_products (named product + one-line why). Only recommend products that ` +
    `genuinely fit and are named in the knowledge base — never invent or oversell. ` +
    `Always use the FULL conversation so far and the chat history provided to keep the brief current ` +
    `as the discussion moves. ` +
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
  model?: string;
}

export interface BriefResult {
  brief: unknown | null;
  citations: Citation[];
  latency_ms: { retrieve: number; first_token: number; total: number };
}

const MAX_TRANSCRIPT_CHARS = 6000;
const MAX_PREV_CHARS = 2000;

/** Render a previous brief object as brace-free "Label: value" lines for the prompt. */
export function prevBriefToText(prev: unknown): string {
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
  arr("Recommended products", o.recommended_products);
  return lines.join("\n");
}

/**
 * Knowledge Boxes that reject a per-request model, remembered per prospect+model for the life of
 * the process. Some deployments do not enable model routing at all: the first refresh discovers
 * that, and the rest of the call stops paying for the failed attempt.
 */
const rejectedModels = new Set<string>();

/** Test helper: forget what we learned about rejected models. */
export function resetRejectedModels(): void {
  rejectedModels.clear();
}

/** Build the ARAG request for one brief refresh (exported for tests). */
export function buildBriefRequest(req: BriefRequest, prospect: ProspectConfig): AskRequest {
  // ARAG's prompt templater only allows {context}/{question}; any other curly braces 400.
  const stripBraces = (s: string) => s.replace(/[{}]/g, "");
  // The transcript is caller-supplied and lands in the prompt: drop injected lines first.
  const screened = screenTranscript((req.transcript ?? "").slice(-MAX_TRANSCRIPT_CHARS)).text;
  const transcript = stripBraces(screened);
  const prevText = req.prev ? stripBraces(prevBriefToText(req.prev)).slice(0, MAX_PREV_CHARS) : "";
  const user =
    "Knowledge base context:\n{context}\n\n" +
    (transcript ? `Conversation so far (most recent last):\n${transcript}\n\n` : "") +
    (prevText ? `Your brief so far — refine and extend it, do not restart:\n${prevText}\n\n` : "") +
    "Most recent words from the conversation: {question}\n\nReturn the updated brief.";

  const body: AskRequest = {
    // Retrieval focuses on the latest words (the current topic); the conversation arc lives in
    // the prompt above so the model reasons over the whole call.
    query: req.text.trim(),
    features: ["semantic", "keyword"],
    // Feed the recent conversation as context so ARAG rephrases the retrieval query with
    // conversation awareness (e.g. resolves "what does that cost").
    context: transcript ? [{ author: "USER", text: transcript.slice(-1500) }] : [],
    prompt: { system: briefSystemPrompt(prospect.display_name, prospect.locale), user },
    reranker: prospect.reranker ?? "predict",
    max_tokens: 600,
    temperature: prospect.temperature ?? 0,
    answer_json_schema: LIVE_BRIEF_SCHEMA,
  };
  // The brief MUST be fast: a per-request model wins, else the prospect's fast brief_model, else
  // its answer model. Slow models don't return answer_json before the timeout → null briefs.
  const model = req.model || prospect.brief_model || prospect.generative_model;
  if (model && !rejectedModels.has(`${prospect.display_name}|${model}`)) body.generative_model = model;
  return body;
}

/**
 * Run one structured-brief refresh. Never throws — on any failure it returns `brief: null` so
 * the client keeps the previous brief on screen instead of flashing an error.
 */
export async function runBrief(
  req: BriefRequest,
  prospect: ProspectConfig,
  deps: { client: AskCapable; voice: VoiceConfig; log: Logger },
  opts: { signal?: AbortSignal } = {},
): Promise<BriefResult> {
  const t0 = performance.now();
  const latency = (ft = 0, rt = 0) => ({
    retrieve: Math.round(rt),
    first_token: Math.round(ft),
    total: Math.round(performance.now() - t0),
  });

  if (!guardInput(req.text).ok) return { brief: null, citations: [], latency_ms: latency() };

  const body = buildBriefRequest(req, prospect);
  const askOpts = { signal: opts.signal, timeoutMs: deps.voice.briefTimeoutMs };
  try {
    let result: AskResult;
    try {
      result = await deps.client.ask(body, askOpts);
    } catch (err) {
      // A Knowledge Box that does not allow the requested model must not cost us the brief: drop
      // the override, retry once, and stop asking for that model on this prospect.
      if (!body.generative_model) throw err;
      const model = body.generative_model;
      deps.log.warn("brief.model.rejected", {
        prospect: prospect.display_name,
        model,
        message: (err as Error).message,
      });
      rejectedModels.add(`${prospect.display_name}|${model}`);
      const retry: AskRequest = { ...body };
      delete retry.generative_model;
      result = await deps.client.ask(retry, askOpts);
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
      citations: citationsFrom(result.retrieval),
      latency_ms: latency(result.timings.firstTokenMs, result.timings.retrieveMs),
    };
  } catch (err) {
    const e = err as { kind?: string; message?: string };
    deps.log.warn("brief.fail", {
      prospect: prospect.display_name,
      kind: e.kind ?? "network",
      message: e.message,
    });
    return { brief: null, citations: [], latency_ms: latency() };
  }
}
