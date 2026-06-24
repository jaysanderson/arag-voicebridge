/**
 * Golden-question harness (SPEC §13, §11 step 5) — the demo gate.
 *
 * Fires every golden question for a prospect at a RUNNING ask-bridge and asserts the
 * expected behaviour (answerable vs handoff), citation coverage (S4), voice-shape rules
 * (S5), and reports p50/p95 latency (S1). No prospect demos until its golden set passes.
 *
 * Usage (no npm — runs on bare Node):
 *   BRIDGE_URL=http://localhost:8080 make eval P=<prospect>
 *   # or directly:
 *   node --experimental-transform-types scripts/golden-eval.ts <prospect>
 *   node --experimental-transform-types scripts/golden-eval.ts   # every prospect in the registry
 *
 * Exit code is non-zero if any check fails — wire it into CI / a pre-demo checklist.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const BRIDGE_URL = process.env.BRIDGE_URL ?? "http://localhost:8080";

interface GoldenQuestion {
  q: string;
  expect: "answer" | "handoff";
  must_include?: string[];
}
interface ProspectConfig {
  display_name: string;
  golden_questions?: GoldenQuestion[];
}

function loadRegistry(): Record<string, ProspectConfig> {
  return JSON.parse(readFileSync(resolve(ROOT, "bridge", "config", "prospects.json"), "utf8"));
}

interface TurnResult {
  answer: string;
  citations: { title: string; url: string; score: number }[];
  handoff: boolean;
  latency_ms: { retrieve: number; first_token: number; total: number };
}

const URL_RE = /\bhttps?:\/\//i;
const MARKER_RE = /\[\s*\d+\s*\]/;

function countSentences(s: string): number {
  return (s.match(/[.!?]+/g) ?? []).length || (s.trim() ? 1 : 0);
}

async function askBridge(prospect: string, question: string): Promise<TurnResult> {
  const res = await fetch(`${BRIDGE_URL}/v1/voice-answer`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prospect, question, conversation_id: "golden", history: [] }),
  });
  if (!res.ok) throw new Error(`bridge HTTP ${res.status}`);
  return (await res.json()) as TurnResult;
}

interface Check {
  ok: boolean;
  label: string;
  detail?: string;
}

function checkTurn(gq: GoldenQuestion, r: TurnResult): Check[] {
  const checks: Check[] = [];

  // Behaviour: answer vs handoff.
  checks.push({
    ok: r.handoff === (gq.expect === "handoff"),
    label: `behaviour expected=${gq.expect} got=${r.handoff ? "handoff" : "answer"}`,
  });

  if (gq.expect === "answer") {
    // S4 — citation coverage.
    checks.push({ ok: r.citations.length >= 1, label: "≥1 citation (S4)" });
    // S5 — voice-shape: no URLs, no markers, ≤3 sentences.
    checks.push({ ok: !URL_RE.test(r.answer), label: "no URLs spoken (S5)" });
    checks.push({ ok: !MARKER_RE.test(r.answer), label: "no citation markers (S5)" });
    checks.push({
      ok: countSentences(r.answer) <= 3,
      label: `≤3 sentences (S5) [${countSentences(r.answer)}]`,
    });
    // Optional content expectations.
    for (const term of gq.must_include ?? []) {
      checks.push({
        ok: r.answer.toLowerCase().includes(term.toLowerCase()),
        label: `mentions "${term}"`,
      });
    }
  }
  return checks;
}

function percentile(values: number[], p: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return Math.round(sorted[Math.max(0, idx)]!);
}

async function runProspect(key: string, cfg: ProspectConfig): Promise<boolean> {
  const questions = cfg.golden_questions ?? [];
  console.log(`\n━━ ${cfg.display_name} (${key}) — ${questions.length} golden questions ━━`);
  if (questions.length < 20) {
    console.log(`  ⚠ only ${questions.length} questions — SPEC §13 wants ≥20 before a real demo.`);
  }

  const latencies: number[] = [];
  let passed = 0;
  let failed = 0;

  for (const gq of questions) {
    let r: TurnResult;
    try {
      r = await askBridge(key, gq.q);
    } catch (err) {
      console.log(`  ✖ "${gq.q}" — bridge error: ${(err as Error).message}`);
      failed++;
      continue;
    }
    latencies.push(r.latency_ms.total);
    const checks = checkTurn(gq, r);
    const bad = checks.filter((c) => !c.ok);
    if (bad.length === 0) {
      passed++;
      console.log(`  ✓ "${gq.q}"  (${r.latency_ms.total}ms)`);
    } else {
      failed++;
      console.log(`  ✖ "${gq.q}"`);
      for (const c of bad) console.log(`      - FAIL: ${c.label}${c.detail ? ` (${c.detail})` : ""}`);
    }
  }

  const p50 = percentile(latencies, 50);
  const p95 = percentile(latencies, 95);
  console.log(`  ── ${passed} passed, ${failed} failed | latency p50=${p50}ms p95=${p95}ms`);
  // S1 targets are end-to-end (incl. STT/TTS/filler). The bridge-only budget is tighter.
  if (p95 > 2500) console.log(`  ⚠ bridge p95 ${p95}ms is high — check generative model / reranker (S1).`);
  return failed === 0;
}

async function main(): Promise<void> {
  const reg = loadRegistry();
  const only = process.argv.slice(2).find((a) => !a.startsWith("--"));
  const entries = only ? [[only, reg[only]] as const] : Object.entries(reg);
  if (only && !reg[only]) {
    console.error(`Unknown prospect "${only}". Known: ${Object.keys(reg).join(", ")}`);
    process.exit(1);
  }

  let allPassed = true;
  for (const [key, cfg] of entries) {
    if (!cfg) continue;
    const ok = await runProspect(key, cfg);
    allPassed = allPassed && ok;
  }

  console.log(`\n${allPassed ? "✓ GOLDEN SET PASSED" : "✖ GOLDEN SET FAILED"} — gate ${allPassed ? "open" : "closed"}.`);
  process.exit(allPassed ? 0 : 1);
}

main().catch((err) => {
  console.error(`golden-eval error: ${(err as Error).message}`);
  console.error(`Is the bridge running at ${BRIDGE_URL}? Start it with: make dev`);
  process.exit(1);
});
