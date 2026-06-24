/**
 * Provision a per-prospect ARAG stored `ask` search configuration (SPEC §6.3.2, §11 step 2).
 *
 * Usage (no npm — runs on bare Node):
 *   ARAG_TOKEN=… make provision P=<prospect> ARGS="--reranker noop|predict --model <m> --dry-run"
 *   # or directly:
 *   ARAG_TOKEN=… node --experimental-transform-types scripts/create-search-config.ts <prospect> \
 *                       [--reranker noop|predict] [--model <generative_model>] [--dry-run]
 *
 * Reads the prospect's kb_id / region / ask_config from bridge/config/prospects.json, injects
 * the canonical voice-answer prompt (scripts/voice-answer-prompt.txt) with placeholders filled,
 * and PUTs the stored config to ARAG. Idempotent: re-running updates the same named config.
 *
 * ⚠️ FIELD-NAME DRIFT (SPEC §18): the exact key paths inside `config` (reranker, generative
 * model, prompt) must be confirmed against the live search-configurations docs at M0. This
 * script is the single place to adjust them — see buildConfigBody().
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

interface Args {
  prospect: string;
  reranker: "noop" | "predict";
  model?: string;
  dryRun: boolean;
}

function parseArgs(argv: string[]): Args {
  const positional = argv.filter((a) => !a.startsWith("--"));
  const prospect = positional[0];
  if (!prospect) {
    fail("Usage: tsx scripts/create-search-config.ts <prospect> [--reranker noop|predict] [--model <name>] [--dry-run]");
  }
  const get = (flag: string): string | undefined => {
    const i = argv.indexOf(flag);
    return i !== -1 ? argv[i + 1] : undefined;
  };
  const reranker = (get("--reranker") ?? "noop") as "noop" | "predict";
  if (reranker !== "noop" && reranker !== "predict") fail("--reranker must be noop or predict");
  return {
    prospect: prospect!,
    reranker,
    model: get("--model"),
    dryRun: argv.includes("--dry-run"),
  };
}

function fail(msg: string): never {
  console.error(`✖ ${msg}`);
  process.exit(1);
}

interface ProspectConfig {
  display_name: string;
  kb_id: string;
  region: string;
  ask_config: string;
  locale: string;
}

function loadProspect(key: string): ProspectConfig {
  const reg = JSON.parse(
    readFileSync(resolve(ROOT, "bridge", "config", "prospects.json"), "utf8"),
  ) as Record<string, ProspectConfig>;
  const cfg = reg[key];
  if (!cfg) fail(`Unknown prospect "${key}". Known: ${Object.keys(reg).join(", ")}`);
  return cfg!;
}

function loadPrompt(p: ProspectConfig): string {
  const template = readFileSync(resolve(ROOT, "scripts", "voice-answer-prompt.txt"), "utf8");
  return template
    .replaceAll("{DISPLAY_NAME}", p.display_name)
    .replaceAll("{LOCALE}", p.locale);
}

/**
 * Build the stored-config body. Structure matches SPEC §6.3.2; confirm exact key paths at M0.
 */
function buildConfigBody(p: ProspectConfig, args: Args, prompt: string) {
  return {
    kind: "ask",
    config: {
      // Governance: filter to English, public security group, drop OCR noise (SPEC §6.3.2/§6.3.3).
      filter_expression: {
        field: { prop: "language", language: "en" },
        paragraph: { not: { prop: "kind", kind: "OCR" } },
        operator: "and",
      },
      security: { groups: ["public"] },
      // Latency levers (SPEC §9): noop reranker by default; fast generative model.
      reranker: args.reranker,
      ...(args.model ? { generative_model: args.model } : {}),
      // The reusable voice-answer prompt — what makes written answers sound spoken (SPEC §8).
      prompt,
      citations: true,
    },
  };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const token = process.env.ARAG_TOKEN;
  const p = loadProspect(args.prospect);
  const prompt = loadPrompt(p);
  const body = buildConfigBody(p, args, prompt);
  const url = `https://${p.region}.rag.progress.cloud/api/v1/kb/${p.kb_id}/search_configurations/${p.ask_config}`;

  console.log(`→ ${args.prospect}: ${p.ask_config} (reranker=${args.reranker}${args.model ? `, model=${args.model}` : ""})`);
  console.log(`  PUT ${url}`);

  if (args.dryRun) {
    console.log("  --dry-run: not sending. Body:");
    console.log(JSON.stringify(body, null, 2));
    return;
  }
  if (!token) fail("ARAG_TOKEN env var is required (and must never be committed).");

  // Try PUT (upsert by name); fall back to POST if the API requires create-then-update.
  const res = await fetch(url, {
    method: "PUT",
    headers: {
      "X-NUCLIA-SERVICEACCOUNT": `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    fail(`ARAG returned HTTP ${res.status}: ${text.slice(0, 400)}`);
  }
  console.log(`✓ Provisioned "${p.ask_config}" for ${p.display_name}.`);
}

main().catch((err) => fail((err as Error).message));
