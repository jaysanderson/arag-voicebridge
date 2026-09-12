/**
 * Citation extraction.
 *
 * Citations are returned as DATA and rendered as chips in the UI — never spoken. ARAG's
 * retrieval results are a map of resources, each with fields → paragraphs → score; we flatten
 * that to `{title, url, score}`, dedupe, sort by score and cap at 4.
 */
import type { RetrievalResults } from "../../vendor/arag-platform/src/index.ts";
import type { Citation } from "../types.ts";

const MAX_CITATIONS = 4;

/** A flattened retrieval result (one per resource). */
export interface RetrievalItem {
  title?: string;
  url?: string;
  score?: number;
}

/** Coerce an unknown score into a finite number, defaulting to 0. */
function toScore(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

/** Best (max) paragraph score across a resource's fields. */
function bestParagraphScore(resource: Record<string, unknown>): number {
  let best = 0;
  const fields = resource.fields as Record<string, unknown> | undefined;
  if (fields && typeof fields === "object") {
    for (const f of Object.values(fields)) {
      const paragraphs = (f as Record<string, unknown> | null)?.paragraphs as
        | Record<string, unknown>
        | undefined;
      if (paragraphs && typeof paragraphs === "object") {
        for (const p of Object.values(paragraphs)) {
          const s = toScore((p as Record<string, unknown>)?.score);
          if (s > best) best = s;
        }
      }
    }
  }
  return best;
}

/** Best-effort source URL for a resource (link resources carry it under origin/url). */
function resourceUrl(resource: Record<string, unknown>): string | undefined {
  const origin = resource.origin as Record<string, unknown> | undefined;
  const meta = resource.metadata as Record<string, unknown> | undefined;
  const u =
    (resource.url as string) ??
    (resource.uri as string) ??
    (origin?.url as string) ??
    (origin?.uri as string) ??
    (meta?.url as string) ??
    undefined;
  return typeof u === "string" && u ? u : undefined;
}

/**
 * Flatten ARAG retrieval results (`{ resources: { id: {...} } }`) into citation candidates.
 * Tolerant: resources without a title or score still yield an item when they carry a URL.
 */
export function retrievalItems(retrieval: RetrievalResults | undefined): RetrievalItem[] {
  const out: RetrievalItem[] = [];
  for (const raw of Object.values(retrieval?.resources ?? {})) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;
    const title = ((r.title ?? r.slug ?? r.name) as string | undefined)?.trim();
    const url = resourceUrl(r)?.trim();
    if (!title && !url) continue;
    out.push({ title: title || undefined, url: url || undefined, score: bestParagraphScore(r) });
  }
  out.sort((a, b) => toScore(b.score) - toScore(a.score));
  return out;
}

/**
 * Build the UI citation list from flattened retrieval items. Robust to partial items: anything
 * without a usable title is skipped rather than surfacing an empty chip.
 */
export function extractCitations(items: RetrievalItem[]): Citation[] {
  const seen = new Set<string>();
  const out: Citation[] = [];

  for (const item of items) {
    const title = (item.title ?? "").trim();
    if (!title) continue;
    const url = (item.url ?? "").trim();
    const score = toScore(item.score);
    const key = `${title}|${url}`.toLowerCase();
    if (seen.has(key)) {
      // Keep the higher score if we see the same source twice.
      const existing = out.find((c) => `${c.title}|${c.url}`.toLowerCase() === key);
      if (existing && score > existing.score) existing.score = score;
      continue;
    }
    seen.add(key);
    out.push({ title, url, score });
  }

  out.sort((a, b) => b.score - a.score);
  return out.slice(0, MAX_CITATIONS);
}

/** Convenience: retrieval results → UI citations. */
export function citationsFrom(retrieval: RetrievalResults | undefined): Citation[] {
  return extractCitations(retrievalItems(retrieval));
}
