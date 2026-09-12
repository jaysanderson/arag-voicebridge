/**
 * Run a prospect's golden set against a RUNNING VoiceBridge (the same job the console's
 * "Run golden set" button starts). Exits non-zero if any question fails — wire it into CI or a
 * pre-demo checklist.
 *
 *   make eval P=progress                       # against http://localhost:8080
 *   BASE_URL=https://… API_KEY=… make eval P=progress
 */
const base = (process.env.BASE_URL ?? "http://localhost:8080").replace(/\/+$/, "");
const key = process.argv[2];
if (!key) {
  console.error("Usage: node scripts/eval.ts <prospect>");
  process.exit(1);
}
const headers: Record<string, string> = { "Content-Type": "application/json" };
if (process.env.API_KEY) headers["X-API-Key"] = process.env.API_KEY;

async function json<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${base}${path}`, { ...init, headers: { ...headers, ...(init?.headers ?? {}) } });
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw new Error(`${path} → HTTP ${res.status}: ${body.detail ?? ""}`);
  return body as T;
}

const { job } = await json<{ job: { id: string } }>("/api/v1/golden-evals", {
  method: "POST",
  body: JSON.stringify({ prospect: key }),
});
let status = "queued";
for (let i = 0; i < 600 && !["succeeded", "failed", "cancelled"].includes(status); i++) {
  await new Promise((r) => setTimeout(r, 500));
  status = (await json<{ status: string }>(`/api/v1/jobs/${job.id}`)).status;
}
const result = await json<{
  ok: boolean;
  display_name: string;
  passed: number;
  total: number;
  latency_ms: { p50: number; p95: number };
  cases: Array<{
    q: string;
    passed: boolean;
    latency_ms: number;
    checks: Array<{ ok: boolean; label: string }>;
  }>;
}>(`/api/v1/golden-evals/${job.id}`);

console.log(`\n━━ ${result.display_name} (${key}) — ${result.total} golden questions ━━`);
for (const c of result.cases) {
  console.log(`  ${c.passed ? "✓" : "✖"} "${c.q}" (${c.latency_ms} ms)`);
  for (const check of c.checks.filter((x) => !x.ok)) console.log(`      - FAIL: ${check.label}`);
}
console.log(
  `  ── ${result.passed} passed, ${result.total - result.passed} failed | latency p50=${result.latency_ms.p50} ms p95=${result.latency_ms.p95} ms`,
);
console.log(
  `\n${result.ok ? "✓ GOLDEN SET PASSED" : "✖ GOLDEN SET FAILED"} — gate ${result.ok ? "open" : "closed"}.`,
);
process.exit(result.ok ? 0 : 1);
