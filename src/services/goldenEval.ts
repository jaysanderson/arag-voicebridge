/**
 * Golden-set evaluation — the demo gate.
 *
 * Fires every golden question for a prospect through the SAME in-process pipeline the live agent
 * uses and asserts behaviour, not just "didn't crash": answerable questions must answer, be
 * grounded (≥1 citation) and voice-shaped (≤3 sentences, no URLs, no citation markers);
 * out-of-scope questions must hand off. Results are stored so the admin panel can show history.
 *
 * No prospect demos until its golden set passes.
 */
import { randomUUID } from "node:crypto";
import type { Collection, Store } from "../../vendor/arag-platform/src/index.ts";
import type { GoldenQuestion, ProspectRecord } from "../types.ts";
import type { MetricsService } from "./metrics.ts";
import { isGuardReason, runTurn, type TurnDeps } from "./pipeline.ts";

export interface GoldenCheck {
  ok: boolean;
  label: string;
}

export interface GoldenCase {
  q: string;
  expect: "answer" | "handoff";
  answer: string;
  handoff: boolean;
  handoff_reason?: string;
  citations: number;
  latency_ms: number;
  checks: GoldenCheck[];
  passed: boolean;
}

export interface GoldenEvalResult {
  id: string;
  createdAt: string;
  updatedAt: string;
  prospect: string;
  display_name: string;
  ok: boolean;
  total: number;
  passed: number;
  failed: number;
  latency_ms: { p50: number; p95: number };
  cases: GoldenCase[];
  startedAt: string;
  finishedAt: string;
}

const URL_RE = /\bhttps?:\/\//i;
const MARKER_RE = /\[\s*\d+\s*\]/;

export function countSentences(s: string): number {
  return (s.match(/[.!?]+/g) ?? []).length || (s.trim() ? 1 : 0);
}

function percentile(values: number[], p: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return Math.round(sorted[Math.max(0, idx)] ?? 0);
}

/** The checks applied to one answered/handed-off turn. */
export function checkTurn(
  gq: GoldenQuestion,
  r: { answer: string; handoff: boolean; citations: number },
): GoldenCheck[] {
  const checks: GoldenCheck[] = [
    {
      ok: r.handoff === (gq.expect === "handoff"),
      label: `behaviour expected=${gq.expect} got=${r.handoff ? "handoff" : "answer"}`,
    },
  ];
  if (gq.expect === "answer") {
    checks.push({ ok: r.citations >= 1, label: "≥1 citation (grounded)" });
    checks.push({ ok: !URL_RE.test(r.answer), label: "no URLs spoken" });
    checks.push({ ok: !MARKER_RE.test(r.answer), label: "no citation markers" });
    checks.push({
      ok: countSentences(r.answer) <= 3,
      label: `≤3 sentences [${countSentences(r.answer)}]`,
    });
    for (const term of gq.must_include ?? []) {
      checks.push({ ok: r.answer.toLowerCase().includes(term.toLowerCase()), label: `mentions "${term}"` });
    }
  }
  return checks;
}

export interface GoldenRunDeps extends TurnDeps {
  metrics?: MetricsService;
}

/** Run the golden set for one prospect. `onCase` reports progress (job events). */
export async function runGoldenEval(
  prospect: ProspectRecord,
  deps: GoldenRunDeps,
  opts: { signal?: AbortSignal; onCase?: (c: GoldenCase, index: number, total: number) => void } = {},
): Promise<GoldenEvalResult> {
  const questions = prospect.golden_questions ?? [];
  const startedAt = new Date().toISOString();
  const cases: GoldenCase[] = [];
  const latencies: number[] = [];

  for (const [i, gq] of questions.entries()) {
    if (opts.signal?.aborted) break;
    const { response } = await runTurn(
      { prospect: prospect.id, question: gq.q, conversation_id: "golden-eval", history: [] },
      prospect,
      deps,
      { signal: opts.signal },
    );
    const summary = {
      answer: response.answer,
      handoff: response.handoff,
      citations: response.citations.length,
    };
    const checks = checkTurn(gq, summary);
    const c: GoldenCase = {
      q: gq.q,
      expect: gq.expect,
      ...summary,
      handoff_reason: response.handoff_reason,
      latency_ms: response.latency_ms.total,
      checks,
      passed: checks.every((x) => x.ok),
    };
    latencies.push(response.latency_ms.total);
    cases.push(c);
    deps.metrics?.record({
      prospect: prospect.id,
      conversation_id: "golden-eval",
      question: gq.q,
      total: response.latency_ms.total,
      first_token: response.latency_ms.first_token,
      retrieve: response.latency_ms.retrieve,
      citations: response.citations.length,
      handoff: response.handoff,
      guard_trip: isGuardReason(response.handoff_reason),
      reason: response.handoff_reason,
      source: "golden-eval",
    });
    opts.onCase?.(c, i + 1, questions.length);
  }

  const passed = cases.filter((c) => c.passed).length;
  const now = new Date().toISOString();
  return {
    id: randomUUID(),
    createdAt: now,
    updatedAt: now,
    prospect: prospect.id,
    display_name: prospect.display_name,
    ok: cases.length > 0 && passed === cases.length,
    total: cases.length,
    passed,
    failed: cases.length - passed,
    latency_ms: { p50: percentile(latencies, 50), p95: percentile(latencies, 95) },
    cases,
    startedAt,
    finishedAt: now,
  };
}

/** Persisted golden-eval history (admin panel). */
export class GoldenEvalStore {
  private readonly col: Collection<GoldenEvalResult>;

  constructor(store: Store, cap = 50) {
    this.col = store.collection<GoldenEvalResult>("golden-evals", { cap });
  }

  save(result: GoldenEvalResult): GoldenEvalResult {
    return this.col.put(result);
  }

  get(id: string): GoldenEvalResult | undefined {
    return this.col.get(id);
  }

  list(opts: { prospect?: string; limit?: number } = {}): GoldenEvalResult[] {
    return this.col.list({
      filter: (r) => !opts.prospect || r.prospect === opts.prospect,
      limit: opts.limit ?? 25,
    });
  }

  /**
   * History for the Knowledge view: summaries only (the per-question detail is fetched by id
   * when a row is opened), paged, newest first.
   */
  query(opts: { prospect?: string; limit?: number; offset?: number } = {}): {
    items: GoldenEvalSummary[];
    total: number;
  } {
    const matches = this.col.list().filter((r) => !opts.prospect || r.prospect === opts.prospect);
    const offset = Math.max(0, opts.offset ?? 0);
    const limit = Math.max(1, Math.min(opts.limit ?? 25, 100));
    return { total: matches.length, items: matches.slice(offset, offset + limit).map(summarise) };
  }

  /** The most recent run for a prospect, as the Knowledge view's gate indicator. */
  latest(prospect: string): GoldenEvalSummary | null {
    const [first] = this.col.list({ filter: (r) => r.prospect === prospect, limit: 1 });
    return first ? summarise(first) : null;
  }
}

/** A golden run without the per-question detail. */
export interface GoldenEvalSummary {
  id: string;
  createdAt: string;
  prospect: string;
  display_name: string;
  ok: boolean;
  total: number;
  passed: number;
  failed: number;
  latency_ms: { p50: number; p95: number };
  startedAt: string;
  finishedAt: string;
}

function summarise(r: GoldenEvalResult): GoldenEvalSummary {
  return {
    id: r.id,
    createdAt: r.createdAt,
    prospect: r.prospect,
    display_name: r.display_name,
    ok: r.ok,
    total: r.total,
    passed: r.passed,
    failed: r.failed,
    latency_ms: r.latency_ms,
    startedAt: r.startedAt,
    finishedAt: r.finishedAt,
  };
}
