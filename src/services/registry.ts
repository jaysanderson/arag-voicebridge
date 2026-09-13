/**
 * Prospect registry — the only thing that changes per prospect.
 *
 * Persisted as a `Store` collection (DATA_DIR/prospects.json) with admin CRUD, so adding a
 * prospect never needs a redeploy. The repo ships `config/prospects.example.json`, which seeds
 * the store on first boot; real KB ids and agent ids live in the store (and in env), not in git.
 */
import { existsSync, readFileSync } from "node:fs";
import type { Branding, Collection, Logger, Store } from "../../vendor/arag-platform/src/index.ts";
import type { VoiceConfig } from "../config.ts";
import { scribeEnabled } from "../config.ts";
import type {
  GoldenQuestion,
  ProspectBrand,
  ProspectConfig,
  ProspectRecord,
  PublicProspect,
} from "../types.ts";

export class ProspectNotFoundError extends Error {
  readonly key: string;
  readonly known: string[];
  constructor(key: string, known: string[]) {
    super(`Unknown prospect "${key}". Known prospects: ${known.join(", ") || "(none)"}.`);
    this.name = "ProspectNotFoundError";
    this.key = key;
    this.known = known;
  }
}

export interface FieldError {
  path: string;
  message: string;
}

export const PROSPECT_KEY_RE = /^[a-z0-9][a-z0-9_-]{1,40}$/;
const REQUIRED: Array<keyof ProspectConfig> = [
  "display_name",
  "kb_id",
  "region",
  "locale",
  "greeting",
  "handoff_msg",
];
const OPTIONAL_STRINGS: Array<keyof ProspectConfig> = [
  "ask_config",
  "generative_model",
  "brief_model",
  "agent_id",
  "voice_id",
];

/** The branding fields a prospect may override (see `ProspectBrand`). */
const BRAND_KEYS = [
  "productName",
  "tagline",
  "logoUrl",
  "primaryColor",
  "accentColor",
  "footerText",
  "poweredBy",
];

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Validate one prospect configuration. Returns [] when valid. */
export function validateProspect(cfg: unknown): FieldError[] {
  const errors: FieldError[] = [];
  if (!isPlainObject(cfg)) return [{ path: "/", message: "must be an object" }];
  for (const field of REQUIRED) {
    const v = cfg[field];
    if (typeof v !== "string" || v.trim().length === 0) {
      errors.push({ path: `/${field}`, message: "is required and must be a non-empty string" });
    }
  }
  for (const field of OPTIONAL_STRINGS) {
    if (cfg[field] !== undefined && typeof cfg[field] !== "string") {
      errors.push({ path: `/${field}`, message: "must be a string" });
    }
  }
  if (cfg.reranker !== undefined && !["noop", "predict"].includes(String(cfg.reranker))) {
    errors.push({ path: "/reranker", message: 'must be "noop" or "predict"' });
  }
  if (cfg.max_tokens !== undefined) {
    const n = Number(cfg.max_tokens);
    if (!Number.isFinite(n) || n < 16 || n > 4000) {
      errors.push({ path: "/max_tokens", message: "must be a number between 16 and 4000" });
    }
  }
  if (cfg.temperature !== undefined) {
    const n = Number(cfg.temperature);
    if (!Number.isFinite(n) || n < 0 || n > 2) {
      errors.push({ path: "/temperature", message: "must be a number between 0 and 2" });
    }
  }
  if (cfg.brand !== undefined) {
    if (!isPlainObject(cfg.brand)) {
      errors.push({ path: "/brand", message: "must be an object" });
    } else {
      for (const [k, v] of Object.entries(cfg.brand)) {
        if (!BRAND_KEYS.includes(k)) errors.push({ path: `/brand/${k}`, message: "is not a branding field" });
        else if (k === "poweredBy" ? typeof v !== "boolean" : typeof v !== "string") {
          errors.push({
            path: `/brand/${k}`,
            message: k === "poweredBy" ? "must be a boolean" : "must be a string",
          });
        }
      }
    }
  }
  if (cfg.golden_questions !== undefined) {
    if (!Array.isArray(cfg.golden_questions)) {
      errors.push({ path: "/golden_questions", message: "must be an array" });
    } else {
      cfg.golden_questions.forEach((q: unknown, i: number) => {
        if (!isPlainObject(q) || typeof q.q !== "string" || !q.q.trim()) {
          errors.push({ path: `/golden_questions/${i}/q`, message: "is required" });
        } else if (q.expect !== "answer" && q.expect !== "handoff") {
          errors.push({ path: `/golden_questions/${i}/expect`, message: 'must be "answer" or "handoff"' });
        } else if (q.must_include !== undefined && !Array.isArray(q.must_include)) {
          errors.push({
            path: `/golden_questions/${i}/must_include`,
            message: "must be an array of strings",
          });
        }
      });
    }
  }
  return errors;
}

/** Validate a registry key. */
export function validateKey(key: string): FieldError[] {
  return PROSPECT_KEY_RE.test(key)
    ? []
    : [{ path: "/key", message: `must match ${PROSPECT_KEY_RE.source} (lowercase, 2–41 chars)` }];
}

/** Strip unknown fields so the store only ever holds the documented shape. */
export function normaliseProspect(cfg: Record<string, unknown>): ProspectConfig {
  const out: ProspectConfig = {
    display_name: String(cfg.display_name),
    kb_id: String(cfg.kb_id),
    region: String(cfg.region),
    locale: String(cfg.locale),
    greeting: String(cfg.greeting),
    handoff_msg: String(cfg.handoff_msg),
  };
  for (const f of OPTIONAL_STRINGS) {
    const v = cfg[f];
    if (typeof v === "string" && v) (out as unknown as Record<string, unknown>)[f] = v;
  }
  if (cfg.reranker !== undefined) out.reranker = String(cfg.reranker);
  if (cfg.max_tokens !== undefined) out.max_tokens = Number(cfg.max_tokens);
  if (cfg.temperature !== undefined) out.temperature = Number(cfg.temperature);
  if (Array.isArray(cfg.golden_questions)) out.golden_questions = cfg.golden_questions as GoldenQuestion[];
  if (isPlainObject(cfg.brand)) {
    const brand: Record<string, unknown> = {};
    for (const k of BRAND_KEYS) if (cfg.brand[k] !== undefined) brand[k] = cfg.brand[k];
    if (Object.keys(brand).length) out.brand = brand as ProspectBrand;
  }
  return out;
}

export class ValidationFailed extends Error {
  readonly errors: FieldError[];
  constructor(errors: FieldError[]) {
    super(errors.map((e) => `${e.path} ${e.message}`).join("; "));
    this.name = "ValidationFailed";
    this.errors = errors;
  }
}

export class ProspectRegistry {
  private readonly col: Collection<ProspectRecord>;
  private readonly log: Logger;
  private readonly cfg: VoiceConfig;

  constructor(deps: { store: Store; log: Logger; voice: VoiceConfig }) {
    this.col = deps.store.collection<ProspectRecord>("prospects");
    this.log = deps.log;
    this.cfg = deps.voice;
  }

  get size(): number {
    return this.col.size;
  }

  /**
   * Seed the store from `config/prospects.example.json` when it is empty (first boot).
   *
   * The shipped example carries placeholders, never real identifiers: `ARAG_KB_ID` and
   * `VOICE_DEFAULT_AGENT_ID` are substituted into the first prospect at boot, so a deployment
   * answers from its own Knowledge Box while the repository stays free of live ids.
   */
  seedFromFile(file: string, defaults: { kbId?: string } = {}): number {
    if (this.col.size > 0 || !existsSync(file)) return 0;
    let raw: Record<string, unknown>;
    try {
      raw = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
    } catch (err) {
      this.log.warn("registry.seed.invalid", { file, message: (err as Error).message });
      return 0;
    }
    let seeded = 0;
    // Stamp increasing createdAt values so registry order matches the file order.
    const base = Date.now();
    for (const [key, value] of Object.entries(raw)) {
      const errors = [...validateKey(key), ...validateProspect(value)];
      if (errors.length) {
        this.log.warn("registry.seed.skip", { key, errors: errors.map((e) => e.path) });
        continue;
      }
      const cfg = normaliseProspect(value as Record<string, unknown>);
      if (seeded === 0) {
        if (this.cfg.defaultAgentId && (!cfg.agent_id || /REPLACE_ME/i.test(cfg.agent_id))) {
          cfg.agent_id = this.cfg.defaultAgentId;
        }
        if (defaults.kbId && /REPLACE_ME/i.test(cfg.kb_id)) cfg.kb_id = defaults.kbId;
      }
      this.col.put({ id: key, createdAt: new Date(base + seeded).toISOString(), ...cfg });
      seeded++;
    }
    this.log.info("registry.seeded", { file, prospects: seeded });
    return seeded;
  }

  /** Registry order = seed/insertion order, so the demo's default prospect is stable. */
  list(): ProspectRecord[] {
    return this.col.list({
      sort: (a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id),
    });
  }

  keys(): string[] {
    return this.list().map((p) => p.id);
  }

  get(key: string): ProspectRecord | undefined {
    return this.col.get(key);
  }

  /** Get or throw ProspectNotFoundError (routes map it to 404). */
  require(key: string): ProspectRecord {
    const found = this.col.get(key);
    if (!found) throw new ProspectNotFoundError(key, this.keys());
    return found;
  }

  create(key: string, cfg: unknown): ProspectRecord {
    const errors = [...validateKey(key), ...validateProspect(cfg)];
    if (errors.length) throw new ValidationFailed(errors);
    const record = this.col.put({ id: key, ...normaliseProspect(cfg as Record<string, unknown>) });
    this.log.info("registry.create", { key });
    return record;
  }

  /** PUT semantics: full replacement of an existing prospect. */
  replace(key: string, cfg: unknown): ProspectRecord {
    this.require(key);
    const errors = validateProspect(cfg);
    if (errors.length) throw new ValidationFailed(errors);
    const record = this.col.put({ id: key, ...normaliseProspect(cfg as Record<string, unknown>) });
    this.log.info("registry.replace", { key });
    return record;
  }

  delete(key: string): boolean {
    const ok = this.col.delete(key);
    if (ok) this.log.info("registry.delete", { key });
    return ok;
  }

  /** Non-secret projection for browsers: no kb_id, region, ask_config or avatar_id. */
  publicView(p: ProspectRecord): PublicProspect {
    return {
      key: p.id,
      display_name: p.display_name,
      locale: p.locale,
      greeting: p.greeting,
      handoff_msg: p.handoff_msg,
      agent_id: p.agent_id ?? null,
      voice_id: p.voice_id ?? null,
      golden_questions: p.golden_questions ?? [],
      scribe_ready: scribeEnabled(this.cfg),
      brand: this.brandFor(p),
    };
  }

  /**
   * Effective branding for a prospect: the deployment's `BRAND_*` branding with the prospect's
   * own overrides on top, so one deployment can serve several partner customers.
   */
  brandFor(p: ProspectRecord): Branding {
    const base = this.cfg.branding;
    const over = p.brand ?? {};
    return {
      ...base,
      ...Object.fromEntries(Object.entries(over).filter(([, v]) => v !== undefined && v !== "")),
    } as Branding;
  }

  /** Admin projection: everything stored (kb ids are operator data, not browser data). */
  adminView(p: ProspectRecord): ProspectRecord {
    return p;
  }
}
