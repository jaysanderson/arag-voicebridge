/**
 * Available generative models for a prospect's KB — powers the model dropdown.
 *
 * ARAG exposes the KB's current model at `GET /configuration` and the selectable options in the
 * learning-configuration `GET /schema`. Schema shapes vary between zones, so parsing is
 * deliberately tolerant and isolated here.
 */
import type { AragClient } from "../../vendor/arag-platform/src/index.ts";

export interface ModelOption {
  id: string;
  label: string;
  /** 1–3 tiers for the picker. speed: 3=fastest. quality: 3=best. price: 3=most expensive. */
  speed: number;
  quality: number;
  price: number;
}

/** Rough speed/quality/price tiers by model family, so the picker is self-explanatory. */
export function classify(id: string): { speed: number; quality: number; price: number } {
  const s = id.toLowerCase();
  const has = (...xs: string[]) => xs.some((x) => s.includes(x));
  // Fast/cheap tier first (ideal for the live brief).
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

/** Pull a list of {value,label}-ish options out of an unknown schema node. */
export function optionsFrom(node: unknown): ModelOption[] {
  if (!node || typeof node !== "object") return [];
  const n = node as Record<string, unknown>;
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

/** Sort fast-first, then quality, and drop provider routing variants that share a label. */
export function rankModels(models: ModelOption[]): ModelOption[] {
  const sorted = [...models].sort(
    (a, b) =>
      b.speed - a.speed ||
      b.quality - a.quality ||
      a.label.localeCompare(b.label) ||
      a.id.length - b.id.length,
  );
  const seen = new Set<string>();
  return sorted.filter((m) => {
    if (seen.has(m.label)) return false;
    seen.add(m.label);
    return true;
  });
}

/**
 * Fetch the KB's available generative models + its current default. Returns an empty list on
 * any failure (the client then shows just "KB default").
 */
export async function fetchModels(
  client: AragClient,
): Promise<{ models: ModelOption[]; current: string | null }> {
  let current: string | null = null;
  try {
    const cfg = await client.getConfiguration();
    current = typeof cfg.generative_model === "string" ? cfg.generative_model : null;
  } catch {
    /* ignore — the picker degrades to "KB default" */
  }
  let models: ModelOption[] = [];
  try {
    const schema = await client.getSchema();
    models = optionsFrom(schema.generative_model);
    if (!models.length)
      models = optionsFrom((schema.properties as Record<string, unknown>)?.generative_model);
    if (!models.length) models = optionsFrom(schema);
  } catch {
    /* ignore */
  }
  return { models: rankModels(models), current };
}
