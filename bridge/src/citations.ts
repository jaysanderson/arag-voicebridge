/**
 * Citation extraction (SPEC §6.2.2 step 6, S4).
 *
 * Citations are returned as DATA and rendered as chips in the UI — never spoken. We pull
 * them from ARAG's retrieval/citation items, dedupe by URL+title, sort by score, cap at 4.
 */

import type { Citation } from "./types.ts";
import type { RetrievalItem } from "./arag.ts";

const MAX_CITATIONS = 4;

/** Coerce an unknown score into a finite 0..1-ish number, defaulting to 0. */
function toScore(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Build the UI citation list from ARAG retrieval items.
 * Robust to partial items: anything without a usable title is skipped rather than
 * surfacing an empty chip.
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
