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
   * Name of a stored `ask` search_configuration. Optional: when set, it takes precedence and
   * the inline fields below are NOT sent (the stored config owns prompt/filters/models).
   */
  searchConfiguration?: string;
  /** Inline {system,user} prompt (SPEC §8) — used when there's no stored config. */
  prompt?: { system: string; user: string };
  /** Reranker: "noop" (fast default) | "predict" (cross-encoder, slower). */
  reranker?: string;
  /** Cap generated tokens — bounds generation latency (SPEC §9). */
  maxTokens?: number;
  /** Override the KB's default generative model (multi-model routing, SPEC §9). */
  generativeModel?: string;
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

/** Best (max) paragraph score across a Progress resource's fields. */
function bestParagraphScore(r: Record<string, unknown>): number {
  let best = 0;
  const fields = r.fields as Record<string, unknown> | undefined;
  if (fields && typeof fields === "object") {
    for (const f of Object.values(fields)) {
      const ps = (f as Record<string, unknown> | null)?.paragraphs as
        | Record<string, unknown>
        | undefined;
      if (ps && typeof ps === "object") {
        for (const p of Object.values(ps)) {
          const s = Number((p as Record<string, unknown>)?.score);
          if (Number.isFinite(s) && s > best) best = s;
        }
      }
    }
  }
  return best;
}

/** Best-effort source URL for a resource (link resources carry it under origin/url). */
function resourceUrl(r: Record<string, unknown>): string | undefined {
  const origin = r.origin as Record<string, unknown> | undefined;
  const meta = r.metadata as Record<string, unknown> | undefined;
  const u =
    (r.url as string) ??
    (r.uri as string) ??
    (origin?.url as string) ??
    (origin?.uri as string) ??
    (meta?.url as string) ??
    undefined;
  return typeof u === "string" && u ? u : undefined;
}

/** Map a Progress "resource" object (from results.resources) to a citation item. */
function resourceToItem(c: unknown): RetrievalItem | undefined {
  if (!c || typeof c !== "object") return undefined;
  const r = c as Record<string, unknown>;
  const title = ((r.title ?? r.label ?? r.name ?? r.slug) as string | undefined)?.trim();
  const url = resourceUrl(r)?.trim();
  const para = bestParagraphScore(r);
  const fallback = Number(r.score ?? r.rank_score ?? r.bm25);
  const score = para || (Number.isFinite(fallback) ? fallback : 0);
  if (!title && !url) return undefined;
  return { title: title || undefined, url: url || undefined, score };
}

/** Map a flat retrieval/citation candidate (array form) to a citation item. */
function simpleItem(c: unknown): RetrievalItem | undefined {
  if (!c || typeof c !== "object") return undefined;
  const r = c as Record<string, unknown>;
  const title = ((r.title ?? r.label ?? r.name) as string | undefined)?.trim();
  const meta = r.metadata as Record<string, unknown> | undefined;
  const url = ((r.url ?? r.uri ?? meta?.url) as string | undefined)?.trim();
  const scoreRaw = r.score ?? r.rank_score ?? r.bm25;
  const score = typeof scoreRaw === "number" ? scoreRaw : Number(scoreRaw);
  if (!title && !url) return undefined;
  return {
    title: title || undefined,
    url: url || undefined,
    score: Number.isFinite(score) ? score : 0,
  };
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
  // Progress shape: { item:{ type:"retrieval", results:{ resources:{ <id>:{ title, fields:{…paragraphs:{…score}} } } } } }
  //                 and { item:{ type:"citations", citations:{ <id>:… } } }.
  // Tolerant fallbacks kept for { resources:{…} } | { find:{ resources:{…} } } and array forms.
  const resourceMaps: Record<string, unknown>[] = [];
  const results = node.results as Record<string, unknown> | undefined;
  if (results && typeof results === "object" && !Array.isArray(results)) {
    const rr = results.resources as Record<string, unknown> | undefined;
    if (rr && typeof rr === "object") resourceMaps.push(rr);
  }
  if (node.resources && typeof node.resources === "object" && !Array.isArray(node.resources))
    resourceMaps.push(node.resources as Record<string, unknown>);
  const find = o.find as Record<string, unknown> | undefined;
  if (find?.resources && typeof find.resources === "object")
    resourceMaps.push(find.resources as Record<string, unknown>);
  if (node.citations && typeof node.citations === "object" && !Array.isArray(node.citations))
    resourceMaps.push(node.citations as Record<string, unknown>);

  for (const map of resourceMaps) {
    for (const r of Object.values(map)) {
      const item = resourceToItem(r);
      if (item) retrieval.push(item);
    }
  }

  // Array forms: results[] | paragraphs[] | retrieval[] | citations[].
  const arr: unknown[] = [];
  if (Array.isArray(node.results)) arr.push(...node.results);
  if (Array.isArray(node.paragraphs)) arr.push(...node.paragraphs);
  if (Array.isArray(o.retrieval)) arr.push(...(o.retrieval as unknown[]));
  if (Array.isArray(o.citations)) arr.push(...(o.citations as unknown[]));
  for (const c of arr) {
    const item = simpleItem(c);
    if (item) retrieval.push(item);
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
  if (params.searchConfiguration) {
    // Stored config wins; it owns prompt/filters/models. Send nothing inline.
    body.search_configuration = params.searchConfiguration;
  } else {
    // Inline config (verified against the live KB): grounding prompt + latency levers.
    if (params.prompt) body.prompt = params.prompt;
    if (params.reranker) body.reranker = params.reranker;
    if (typeof params.maxTokens === "number") body.max_tokens = params.maxTokens;
    if (params.generativeModel) body.generative_model = params.generativeModel;
  }

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
