/**
 * Opt-in LIVE smoke test: three golden questions against the real Knowledge Box, through the
 * real pipeline, using the credentials in `.env`. Read-only — it only calls ARAG `/ask`.
 *
 *   make smoke                      # default prospect (the first in the registry)
 *   make smoke ARGS="progress 5"    # prospect key + number of questions
 *
 * Never prints secrets. Exits non-zero if a question fails its golden expectation.
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { readVoiceEnv } from "../src/config.ts";
import { AragClientPool } from "../src/services/clientPool.ts";
import { checkTurn } from "../src/services/goldenEval.ts";
import { runTurn } from "../src/services/pipeline.ts";
import type { ProspectConfig, Registry } from "../src/types.ts";
import { assertAragEnv, Logger, loadDotEnv, readEnv } from "../vendor/arag-platform/src/index.ts";

const [keyArg, countArg] = process.argv.slice(2);
loadDotEnv();
const env = readEnv();
if (env.arag.mock) {
  console.error("make smoke runs against the LIVE Knowledge Box — unset ARAG_MOCK first.");
  process.exit(1);
}
assertAragEnv(env);
const voice = readVoiceEnv();
const log = new Logger({ level: "warn", ringSize: 0 });

const dataFile = resolve(env.dataDir, "prospects.json");
const exampleFile = resolve(import.meta.dirname ?? ".", "..", "config", "prospects.example.json");
let registry: Registry = {};
if (existsSync(dataFile)) {
  const rows = JSON.parse(readFileSync(dataFile, "utf8")) as Array<ProspectConfig & { id: string }>;
  for (const r of rows) registry[r.id] = r;
} else {
  registry = JSON.parse(readFileSync(exampleFile, "utf8")) as Registry;
}

const key = keyArg ?? Object.keys(registry)[0];
const prospect = key ? registry[key] : undefined;
if (!key || !prospect) {
  console.error(`Unknown prospect "${keyArg}". Known: ${Object.keys(registry).join(", ")}`);
  process.exit(1);
}
const questions = (prospect.golden_questions ?? []).slice(0, Number(countArg ?? 3));
if (questions.length === 0) {
  console.error(`Prospect "${key}" has no golden questions.`);
  process.exit(1);
}

const clients = new AragClientPool({ env, voice, log });
console.log(`\n━━ LIVE smoke · ${prospect.display_name} (${key}) · ${questions.length} questions ━━`);
console.log(`   KB ${prospect.kb_id.slice(0, 8)}… in ${prospect.region || voice.aragRegionDefault}\n`);

const latencies: number[] = [];
let failed = 0;
for (const gq of questions) {
  const { response } = await runTurn(
    { prospect: key, question: gq.q, conversation_id: "smoke", history: [] },
    prospect,
    { clientFor: (p) => clients.for(p), voice, log },
  );
  latencies.push(response.latency_ms.total);
  const checks = checkTurn(gq, {
    answer: response.answer,
    handoff: response.handoff,
    citations: response.citations.length,
  });
  const bad = checks.filter((c) => !c.ok);
  if (bad.length) failed++;
  console.log(`${bad.length ? "✖" : "✓"} ${gq.q}`);
  console.log(`   ${response.answer}`);
  console.log(
    `   ${response.handoff ? `handoff (${response.handoff_reason})` : "answered"} · ` +
      `${response.citations.length} citations · retrieve ${response.latency_ms.retrieve} ms · ` +
      `first token ${response.latency_ms.first_token} ms · total ${response.latency_ms.total} ms`,
  );
  for (const c of bad) console.log(`   FAIL: ${c.label}`);
  console.log("");
}

const sorted = [...latencies].sort((a, b) => a - b);
const pct = (p: number) => sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)] ?? 0;
console.log(
  `p50 ${pct(50)} ms · p95 ${pct(95)} ms · ${questions.length - failed}/${questions.length} passed`,
);
process.exit(failed ? 1 : 0);
