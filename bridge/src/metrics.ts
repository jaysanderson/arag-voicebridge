/**
 * In-memory per-turn metrics (SPEC §13).
 *
 * A bounded ring buffer of recent turns feeds a /metrics endpoint and the control panel's
 * dashboard: p50/p95 perceived latency, handoff rate, citation coverage, guard trips. This
 * is demo-grade telemetry — for production you'd ship these to a real TSDB, but the shape is
 * the same.
 */

export interface TurnRecord {
  prospect: string;
  total: number;
  first_token: number;
  retrieve: number;
  citations: number;
  handoff: boolean;
  guard_trip: boolean;
}

const CAP = 500;
const ring: TurnRecord[] = [];

export function recordTurn(rec: TurnRecord): void {
  ring.push(rec);
  if (ring.length > CAP) ring.shift();
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return Math.round(sorted[Math.max(0, idx)] ?? 0);
}

export interface MetricsSnapshot {
  turns: number;
  latency_total_ms: { p50: number; p95: number };
  latency_first_token_ms: { p50: number; p95: number };
  handoff_rate: number;
  citation_coverage: number;
  guard_trip_rate: number;
  by_prospect: Record<string, number>;
}

/** Compute a snapshot over the current window (optionally filtered by prospect). */
export function snapshot(prospect?: string): MetricsSnapshot {
  const rows = prospect ? ring.filter((r) => r.prospect === prospect) : ring;
  const n = rows.length;
  const totals = rows.map((r) => r.total).sort((a, b) => a - b);
  const firsts = rows.map((r) => r.first_token).sort((a, b) => a - b);
  const substantive = rows.filter((r) => !r.handoff);
  const withCite = substantive.filter((r) => r.citations > 0).length;

  const byProspect: Record<string, number> = {};
  for (const r of ring) byProspect[r.prospect] = (byProspect[r.prospect] ?? 0) + 1;

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

function round2(x: number): number {
  return Math.round(x * 100) / 100;
}

/** Test/ops helper. */
export function resetMetrics(): void {
  ring.length = 0;
}
