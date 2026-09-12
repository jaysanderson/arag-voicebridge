/**
 * Per-turn metrics and the turn log.
 *
 * A bounded, persisted ring of recent turns feeds `GET /api/v1/metrics` (p50/p95 latency,
 * handoff rate, citation coverage, guard-trip rate) and the admin turn log. This is demo-grade
 * telemetry — in production these records would ship to a TSDB — but the shape is the same.
 *
 * Privacy: the question text is recorded only for turns that passed the input guard. A guard
 * trip stores the reason and nothing else, so unsafe or injected prompts are never retained.
 */
import { randomUUID } from "node:crypto";
import type { Collection, Store } from "../../vendor/arag-platform/src/index.ts";
import type { TurnRecord } from "../types.ts";

export interface MetricsSnapshot {
  turns: number;
  latency_total_ms: { p50: number; p95: number };
  latency_first_token_ms: { p50: number; p95: number };
  handoff_rate: number;
  citation_coverage: number;
  guard_trip_rate: number;
  by_prospect: Record<string, number>;
}

export type TurnInput = Omit<TurnRecord, "id" | "createdAt" | "updatedAt">;

/** Filters behind the Quality turn log. */
export interface TurnQuery {
  prospect?: string;
  source?: "voice-answer" | "golden-eval";
  /** answered | handoff | guard (a guard trip is always also a handoff). */
  outcome?: "answered" | "handoff" | "guard";
  reason?: string;
  limit?: number;
  offset?: number;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return Math.round(sorted[Math.max(0, idx)] ?? 0);
}

function round2(x: number): number {
  return Math.round(x * 100) / 100;
}

export class MetricsService {
  private readonly col: Collection<TurnRecord>;

  constructor(deps: { store: Store; cap?: number }) {
    this.col = deps.store.collection<TurnRecord>("turns", { cap: deps.cap ?? 500 });
  }

  /** Record one turn. The caller must already have redacted unsafe question text. */
  record(turn: TurnInput): TurnRecord {
    return this.col.put({ id: randomUUID(), ...turn });
  }

  /** Recent turns, newest first. */
  recent(opts: { prospect?: string; limit?: number } = {}): TurnRecord[] {
    return this.col.list({
      filter: (t) => !opts.prospect || t.prospect === opts.prospect,
      limit: opts.limit ?? 100,
    });
  }

  /**
   * The Quality turn log: the same ring, filtered by outcome so an operator can go straight to
   * the turns that handed off or tripped a guard, and paged so the table does not grow unbounded.
   */
  query(opts: TurnQuery = {}): { items: TurnRecord[]; total: number } {
    const matches = this.col.list().filter((t) => {
      if (opts.prospect && t.prospect !== opts.prospect) return false;
      if (opts.source && t.source !== opts.source) return false;
      if (opts.outcome === "handoff" && !t.handoff) return false;
      if (opts.outcome === "answered" && t.handoff) return false;
      if (opts.outcome === "guard" && !t.guard_trip) return false;
      return !opts.reason || t.reason === opts.reason;
    });
    const offset = Math.max(0, opts.offset ?? 0);
    const limit = Math.max(1, Math.min(opts.limit ?? 100, 500));
    return { total: matches.length, items: matches.slice(offset, offset + limit) };
  }

  /** How often each handoff/guard reason fired in the current window. */
  reasons(prospect?: string): Array<{ reason: string; count: number; guard: boolean }> {
    const counts = new Map<string, { count: number; guard: boolean }>();
    for (const t of this.col.list()) {
      if (prospect && t.prospect !== prospect) continue;
      if (!t.reason) continue;
      const prev = counts.get(t.reason) ?? { count: 0, guard: t.guard_trip };
      counts.set(t.reason, { count: prev.count + 1, guard: prev.guard || t.guard_trip });
    }
    return [...counts.entries()]
      .map(([reason, v]) => ({ reason, count: v.count, guard: v.guard }))
      .sort((a, b) => b.count - a.count);
  }

  get size(): number {
    return this.col.size;
  }

  /** Compute a snapshot over the current window (optionally filtered by prospect). */
  snapshot(prospect?: string): MetricsSnapshot {
    const all = this.col.list();
    const rows = prospect ? all.filter((r) => r.prospect === prospect) : all;
    const n = rows.length;
    const totals = rows.map((r) => r.total).sort((a, b) => a - b);
    const firsts = rows.map((r) => r.first_token).sort((a, b) => a - b);
    const substantive = rows.filter((r) => !r.handoff);
    const withCite = substantive.filter((r) => r.citations > 0).length;

    const byProspect: Record<string, number> = {};
    for (const r of all) byProspect[r.prospect] = (byProspect[r.prospect] ?? 0) + 1;

    return {
      turns: n,
      latency_total_ms: { p50: percentile(totals, 50), p95: percentile(totals, 95) },
      latency_first_token_ms: { p50: percentile(firsts, 50), p95: percentile(firsts, 95) },
      handoff_rate: n ? round2(rows.filter((r) => r.handoff).length / n) : 0,
      citation_coverage: substantive.length ? round2(withCite / substantive.length) : 1,
      guard_trip_rate: n ? round2(rows.filter((r) => r.guard_trip).length / n) : 0,
      by_prospect: byProspect,
    };
  }

  reset(): void {
    this.col.clear();
  }
}
