/**
 * ARAG `/ask` client (SPEC §6.3.1, §18).
 *
 * Calls Progress Agentic RAG's NDJSON streaming `/ask` endpoint and assembles:
 *   - the concatenated answer text (from streamed `answer` chunks),
 *   - retrieval items (for citations),
 *   - first-token and retrieval timings.
 *
 * ⚠️ FIELD-NAME DRIFT (SPEC §18): the request body and NDJSON item shapes below are
 * correct in STRUCTURE; exact item-type names / key paths must be confirmed against
 * https://docs.rag.progress.cloud/docs/rag/advanced/ask at M0. ALL of that uncertainty is
 * contained in this one file — `interpretLine()` is the single place to adjust. The rest of
 * the bridge depends only on the normalised { answerText, retrieval } it returns.
 */

import { config } from "./config.ts";
import { log } from "./logger.ts";
import type { Author } from "./types.ts";

/** A normalised retrieval result used to build citations. */
export interface RetrievalItem {
  title?: string;
  url?: string;
  score?: number;
}

export interface AskParams {
  kbId: string;
  region: string;
  query: string;
  context: { author: Author; text: string }[];
  /**
   * Name of a stored `ask` search_configuration. Optional: when omitted, ARAG uses its
   * defaults (the bridge still voice-shapes the answer and extracts citations). Provision
   * one per prospect to apply the voice-answer prompt + governance filters (SPEC §6.3.2).
   */
  searchConfiguration?: string;
}

export interface AskResult {
  /** Concatenated answer text, raw (not yet voice-shaped). */
  answerText: string;
  /** Retrieval items collected from the stream. */
  retrieval: RetrievalItem[];
  /** ms from request start to first answer token (or 0 if none). */
  firstTokenMs: number;
  /** ms from request start to first retrieval item (or 0 if none). */
  retrieveMs: number;
}

export class AragError extends Error {
  constructor(
    message: string,
    public readonly kind: "timeout" | "http" | "network",
    public readonly status?: number,
  ) {
    super(message);
    this.name = "AragError";
  }
}

/** Build the `/ask` URL for a region + KB. */
export function askUrl(region: string, kbId: string): string {
  return `https://${region}.rag.progress.cloud/api/v1/kb/${kbId}/ask`;
}

/**
 * Interpret one parsed NDJSON object into the things we care about. Tolerant by design:
 * it probes several plausible key paths so minor schema differences don't break a turn.
 *
 * Returns any answer-text fragment and any retrieval items found in this line.
 */
export function interpretLine(obj: unknown): {
  answerChunk?: string;
  retrieval: RetrievalItem[];
} {
  const retrieval: RetrievalItem[] = [];
  let answerChunk: string | undefined;

  if (typeof obj !== "object" || obj === null) return { retrieval };
  const o = obj as Record<string, unknown>;

  // Some streams wrap each event as { item: {...} }; unwrap if present.
  const node = (o.item && typeof o.item === "object" ? o.item : o) as Record<string, unknown>;
  const type = typeof node.type === "string" ? node.type.toLowerCase() : undefined;

  // --- answer text chunks ---
  // Shapes seen/expected: {type:"answer", text:"..."} | {answer:"..."} | {text:"..."}
  if (type === "answer" || type === "generative") {
    const t = node.text ?? node.answer ?? node.content;
    if (typeof t === "string") answerChunk = t;
  } else if (typeof o.answer === "string") {
    answerChunk = o.answer;
  } else if (type === undefined && typeof node.text === "string" && !("paragraphs" in node)) {
    // Bare {text:"..."} chunk with no other structure.
    answerChunk = node.text as string;
  }

  // --- retrieval items (for citations) ---
  // Shapes: {type:"retrieval", results:[...]} | {find:{resources:{...}}} | {paragraphs:[...]}
  const candidates: unknown[] = [];
  if (Array.isArray(node.results)) candidates.push(...node.results);
  if (Array.isArray(node.paragraphs)) candidates.push(...node.paragraphs);
  if (Array.isArray(o.retrieval)) candidates.push(...(o.retrieval as unknown[]));
  if (Array.isArray(o.citations)) candidates.push(...(o.citations as unknown[]));

  // Nested resources map: { resources: { id: { title, ... } } }
  const resources = (node.resources ?? (o.find as Record<string, unknown>)?.resources) as
    | Record<string, unknown>
    | undefined;
  if (resources && typeof resources === "object") {
    candidates.push(...Object.values(resources));
  }

  for (const c of candidates) {
    if (typeof c !== "object" || c === null) continue;
    const r = c as Record<string, unknown>;
    const title =
      (r.title as string) ?? (r.label as string) ?? (r.name as string) ?? undefined;
    const url =
      (r.url as string) ??
      (r.uri as string) ??
      ((r.metadata as Record<string, unknown>)?.url as string) ??
      undefined;
    const scoreRaw = r.score ?? r.rank_score ?? r.bm25 ?? undefined;
    const score = typeof scoreRaw === "number" ? scoreRaw : Number(scoreRaw);
    if (title || url) {
      retrieval.push({
        title: title?.trim(),
        url: url?.trim(),
        score: Number.isFinite(score) ? score : 0,
      });
    }
  }

  return { answerChunk, retrieval };
}

/**
 * Call ARAG `/ask` and stream the NDJSON response.
 *
 * @param signal optional AbortSignal so a barge-in can cancel the in-flight turn (SPEC §7.4).
 * @throws AragError on timeout, HTTP error, or network failure — the pipeline maps these to
 *         a graceful handoff (SPEC §6.2.3), never dead air.
 */
export async function askArag(params: AskParams, signal?: AbortSignal): Promise<AskResult> {
  const url = askUrl(params.region, params.kbId);
  const body: Record<string, unknown> = {
    query: params.query,
    context: params.context,
    // SPEC §6.3.1: relations excluded for speed; never add unless a demo needs NER/graph.
    features: ["semantic", "keyword"],
    citations: true,
  };
  // Only send a stored config if the prospect has one; otherwise ARAG uses its defaults.
  if (params.searchConfiguration) body.search_configuration = params.searchConfiguration;

  const timeout = AbortSignal.timeout(config.aragTimeoutMs);
  // Combine the caller's signal (barge-in) with our timeout.
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;

  const start = performance.now();
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        "X-NUCLIA-SERVICEACCOUNT": `Bearer ${config.aragToken}`,
        "Content-Type": "application/json",
        Accept: "application/x-ndjson",
      },
      body: JSON.stringify(body),
      signal: combined,
    });
  } catch (err) {
    if (timeout.aborted) throw new AragError("ARAG request timed out", "timeout");
    if (signal?.aborted) throw new AragError("ARAG request aborted (barge-in)", "network");
    throw new AragError(`ARAG network error: ${(err as Error).message}`, "network");
  }

  if (!res.ok || !res.body) {
    throw new AragError(`ARAG returned HTTP ${res.status}`, "http", res.status);
  }

  let answerText = "";
  const retrieval: RetrievalItem[] = [];
  let firstTokenMs = 0;
  let retrieveMs = 0;

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let nl: number;
      // Process complete NDJSON lines; keep the trailing partial in `buffer`.
      while ((nl = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (!line) continue;
        let parsed: unknown;
        try {
          parsed = JSON.parse(line);
        } catch {
          // SPEC §6.2.3: skip malformed lines, never crash the turn.
          log.warn("arag.ndjson.skip", { line: line.slice(0, 120) });
          continue;
        }
        const { answerChunk, retrieval: items } = interpretLine(parsed);
        if (items.length && retrieveMs === 0) retrieveMs = performance.now() - start;
        retrieval.push(...items);
        if (answerChunk) {
          if (firstTokenMs === 0) firstTokenMs = performance.now() - start;
          answerText += answerChunk;
        }
      }
    }
  } catch (err) {
    if (timeout.aborted) throw new AragError("ARAG stream timed out", "timeout");
    if (signal?.aborted) throw new AragError("ARAG stream aborted (barge-in)", "network");
    throw new AragError(`ARAG stream error: ${(err as Error).message}`, "network");
  }

  // Flush any final buffered line.
  const tail = buffer.trim();
  if (tail) {
    try {
      const { answerChunk, retrieval: items } = interpretLine(JSON.parse(tail));
      retrieval.push(...items);
      if (answerChunk) {
        if (firstTokenMs === 0) firstTokenMs = performance.now() - start;
        answerText += answerChunk;
      }
    } catch {
      /* ignore trailing partial */
    }
  }

  return { answerText: answerText.trim(), retrieval, firstTokenMs, retrieveMs };
}
