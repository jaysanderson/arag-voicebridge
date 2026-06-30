/**
 * Available generative models for a KB — powers the model dropdown.
 *
 * ⚠️ LIVE-VERIFY: the learning-configuration schema endpoint + its shape are confirmed against
 * the live KB at integration time. Parsing is tolerant and isolated here.
 */

import { config } from "./config.ts";
import type { ProspectConfig } from "./types.ts";

export interface ModelOption {
  id: string;
  label: string;
  /** 1–3 tiers for the picker. speed: 3=fastest. quality: 3=best. price: 3=most expensive. */
  speed: number;
  quality: number;
  price: number;
}

/** Rough speed/quality/price tiers by model family, so the picker is self-explanatory. */
function classify(id: string): { speed: number; quality: number; price: number } {
  const s = id.toLowerCase();
  const has = (...xs: string[]) => xs.some((x) => s.includes(x));
  // Fast/cheap tier first (these are ideal for the live brief).
  if (has("flash-lite", "nano")) return { speed: 3, quality: 2, price: 1 };
  if (has("haiku")) return { speed: 3, quality: 2, price: 1 };
  if (has("flash")) return { speed: 3, quality: 2, price: 1 };
  if (has("-mini") || s.endsWith("mini")) return { speed: 3, quality: 2, price: 1 };
  if (has("lite")) return { speed: 3, quality: 2, price: 1 };
  // Premium / slow reasoning.
  if (has("opus")) return { speed: 1, quality: 3, price: 3 };
  if (/(?:^|-)o[134](?:-|$)/.test(s)) return { speed: 1, quality: 3, price: 3 };
  if (has("gpt-5", "chatgpt-5", "chatgpt5", "5.5")) return { speed: 2, quality: 3, price: 3 };
  // Balanced high quality.
  if (has("sonnet")) return { speed: 2, quality: 3, price: 2 };
  if (has("4.1") || has("4o")) return { speed: 2, quality: 3, price: 2 };
  if (has("pro")) return { speed: 2, quality: 3, price: 2 };
  // Mid.
  if (has("mistral")) return { speed: 2, quality: 2, price: 2 };
  if (has("llama")) return { speed: 2, quality: 2, price: 1 };
  return { speed: 2, quality: 2, price: 2 };
}

function base(p: ProspectConfig): string {
  const region = p.region || config.aragRegionDefault;
  return `https://${region}.rag.progress.cloud/api/v1/kb/${p.kb_id}`;
}
function headers() {
  return { "X-NUCLIA-SERVICEACCOUNT": `Bearer ${config.aragToken}` };
}

/** Pull a list of {value,label}-ish options out of an unknown schema node. */
function optionsFrom(node: unknown): ModelOption[] {
  if (!node || typeof node !== "object") return [];
  const n = node as Record<string, unknown>;
  // Common shapes: { options: [{value,name|title|label}] } | { enum: [..] }
  const raw =
    (Array.isArray(n.options) && n.options) ||
    (Array.isArray((n.generative_model as Record<string, unknown>)?.options) &&
      ((n.generative_model as Record<string, unknown>).options as unknown[])) ||
    (Array.isArray(n.enum) && n.enum) ||
    [];
  const out: ModelOption[] = [];
  for (const o of raw as unknown[]) {
    if (typeof o === "string") out.push({ id: o, label: o, ...classify(o) });
    else if (o && typeof o === "object") {
      const r = o as Record<string, unknown>;
      const id = (r.value ?? r.id ?? r.model ?? r.name) as string | undefined;
      const label = (r.name ?? r.title ?? r.label ?? id) as string | undefined;
      if (id) out.push({ id, label: label ?? id, ...classify(id) });
    }
  }
  return out;
}

/**
 * Fetch the KB's available generative models + its current default. Returns an empty list on
 * any failure (the client then shows just "KB default").
 */
export async function fetchModels(
  p: ProspectConfig,
): Promise<{ models: ModelOption[]; current: string | null }> {
  let current: string | null = null;
  // Current default (also confirms the KB is reachable).
  try {
    const cfg = await fetch(`${base(p)}/configuration`, { headers: headers() });
    if (cfg.ok) {
      const j = (await cfg.json()) as Record<string, unknown>;
      current = (j.generative_model as string) ?? null;
    }
  } catch {
    /* ignore */
  }
  // Available options from the learning-config schema.
  let models: ModelOption[] = [];
  try {
    const sc = await fetch(`${base(p)}/schema`, { headers: headers() });
    if (sc.ok) {
      const schema = (await sc.json()) as Record<string, unknown>;
      models =
        optionsFrom(schema.generative_model) ||
        optionsFrom((schema.properties as Record<string, unknown>)?.generative_model) ||
        [];
      if (!models.length) models = optionsFrom(schema); // last-ditch
    }
  } catch {
    /* ignore */
  }
  // Fast-first (best for the live brief), then higher quality; prefer the plain (shortest) id.
  models.sort(
    (a, b) =>
      b.speed - a.speed || b.quality - a.quality || a.label.localeCompare(b.label) || a.id.length - b.id.length,
  );
  // Dedupe provider routing variants that share a label (claude-…/gcp-claude-…/aws-claude-…).
  const seen = new Set<string>();
  models = models.filter((m) => (seen.has(m.label) ? false : (seen.add(m.label), true)));
  return { models, current };
}
