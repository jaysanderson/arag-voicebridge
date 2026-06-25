/**
 * Structured "live brief" — used by the ambient Listen mode.
 *
 * Instead of a text blob, we pass an `answer_json_schema` to ARAG `/ask` so the answer comes
 * back as a well-structured object (ARAG's `answer_json`). The client renders it as laid-out
 * sections (topic / summary / key points / suggested responses) plus the citation rail.
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
  name: "live_brief",
  description:
    "A concise, well-structured live brief of the knowledge most relevant to the current moment " +
    "in a conversation, for someone who needs to stay informed hands-free.",
  parameters: {
    type: "object",
    properties: {
      topic: {
        type: "string",
        description: "The current subject being discussed, in 3 to 6 words. Empty if unclear.",
      },
      summary: {
        type: "string",
        description:
          "One or two short sentences summarising the most relevant information right now, " +
          "drawn ONLY from the knowledge base. Empty string if nothing relevant.",
      },
      key_points: {
        type: "array",
        items: { type: "string" },
        description:
          "2 to 5 short, factual bullet points grounded ONLY in the knowledge base. " +
          "Empty array if nothing relevant.",
      },
      suggested_responses: {
        type: "array",
        items: { type: "string" },
        description:
          "0 to 3 helpful, grounded things the listener could say next. Empty array if none.",
      },
    },
    required: ["topic", "summary", "key_points"],
  },
} as const;

function briefSystemPrompt(displayName: string): string {
  return (
    `You produce a live brief for someone in a live conversation related to ${displayName}. ` +
    `Use ONLY the information in the provided context. Fill the fields from the knowledge base; ` +
    `never use outside knowledge and never invent facts. If the context contains nothing relevant ` +
    `to the latest discussion, return an empty summary and empty arrays. Keep everything concise.`
  );
}

export interface BriefResult {
  brief: unknown | null;
  citations: Citation[];
  latency_ms: { retrieve: number; first_token: number; total: number };
}

/**
 * Run one structured-brief lookup. Never throws — on any failure returns brief:null so the
 * client simply keeps the previous brief on screen.
 */
export async function runBrief(
  text: string,
  prospect: ProspectConfig,
  schema: unknown,
  signal?: AbortSignal,
): Promise<BriefResult> {
  const t0 = performance.now();
  const latency = (ft = 0, rt = 0) => ({
    retrieve: Math.round(rt),
    first_token: Math.round(ft),
    total: Math.round(performance.now() - t0),
  });

  const guard = guardInput(text);
  if (!guard.ok) return { brief: null, citations: [], latency_ms: latency() };

  const askParams: AskParams = {
    kbId: prospect.kb_id,
    region: prospect.region || config.aragRegionDefault,
    query: text.trim(),
    context: buildContext([], config.maxHistoryTurns),
    prompt: { system: briefSystemPrompt(prospect.display_name), user: "Context:\n{context}\n\nDiscussion: {question}" },
    reranker: prospect.reranker ?? "predict",
    maxTokens: 500,
    temperature: prospect.temperature ?? 0,
    answerJsonSchema: schema ?? LIVE_BRIEF_SCHEMA,
  };

  let result: AskResult;
  try {
    result = await askArag(askParams, signal);
  } catch (err) {
    const kind = err instanceof AragError ? err.kind : "network";
    log.warn("brief.fail", { prospect: prospect.display_name, kind });
    return { brief: null, citations: [], latency_ms: latency() };
  }

  // Prefer the structured answer_json; fall back to parsing answerText if a model returned text.
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
