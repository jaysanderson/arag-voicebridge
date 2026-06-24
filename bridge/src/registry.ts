/**
 * Config registry — the only thing that changes per prospect (SPEC §6.4).
 *
 * Loaded from bridge/config/prospects.json. Kept in-memory and re-readable so a demo
 * operator can edit the JSON and reload without a redeploy (the control panel can hit
 * POST /admin/reload). Promote to a table later if runtime edits are needed.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import type { ProspectConfig, Registry } from "./types.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REGISTRY_PATH = resolve(__dirname, "..", "config", "prospects.json");

let cache: Registry | null = null;

const REQUIRED_FIELDS: (keyof ProspectConfig)[] = [
  "display_name",
  "kb_id",
  "region",
  "ask_config",
  "locale",
  "greeting",
  "handoff_msg",
];

function validate(reg: unknown): Registry {
  if (typeof reg !== "object" || reg === null || Array.isArray(reg)) {
    throw new Error("Registry must be a JSON object of { prospectKey: config }.");
  }
  for (const [key, value] of Object.entries(reg as Record<string, unknown>)) {
    if (typeof value !== "object" || value === null) {
      throw new Error(`Prospect "${key}" must be an object.`);
    }
    const cfg = value as Record<string, unknown>;
    for (const field of REQUIRED_FIELDS) {
      if (typeof cfg[field] !== "string" || (cfg[field] as string).length === 0) {
        throw new Error(`Prospect "${key}" is missing required string field "${field}".`);
      }
    }
  }
  return reg as Registry;
}

/** Load (or reload) the registry from disk. Throws on malformed config. */
export function loadRegistry(): Registry {
  const raw = readFileSync(REGISTRY_PATH, "utf8");
  cache = validate(JSON.parse(raw));
  return cache;
}

/** Get the cached registry, loading it on first use. */
export function getRegistry(): Registry {
  return cache ?? loadRegistry();
}

/** Force a reload from disk (used by the admin reload endpoint). */
export function reloadRegistry(): Registry {
  return loadRegistry();
}

/**
 * Resolve a prospect key to its config.
 * @throws if the prospect is unknown — the caller maps this to a 404.
 */
export function resolveProspect(key: string): ProspectConfig {
  const reg = getRegistry();
  const cfg = reg[key];
  if (!cfg) {
    throw new ProspectNotFoundError(key, Object.keys(reg));
  }
  return cfg;
}

export class ProspectNotFoundError extends Error {
  constructor(
    public readonly key: string,
    public readonly known: string[],
  ) {
    super(`Unknown prospect "${key}". Known prospects: ${known.join(", ") || "(none)"}.`);
    this.name = "ProspectNotFoundError";
  }
}
