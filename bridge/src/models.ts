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
    if (typeof o === "string") out.push({ id: o, label: o });
    else if (o && typeof o === "object") {
      const r = o as Record<string, unknown>;
      const id = (r.value ?? r.id ?? r.model ?? r.name) as string | undefined;
      const label = (r.name ?? r.title ?? r.label ?? id) as string | undefined;
      if (id) out.push({ id, label: label ?? id });
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
  return { models, current };
}
