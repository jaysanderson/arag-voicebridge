/**
 * Real-time listening — the product's hero capability.
 *
 * A listen session ingests a conversation as it happens, from any source: an STT vendor's
 * realtime stream, a telephony webhook, a meeting bot, or a human typing. The service keeps the
 * rolling transcript, decides when a refresh is worth an LLM call, maintains ONE evolving brief
 * (grounded in the prospect's Knowledge Box), accumulates the citations seen across the call and
 * records how long each refresh took.
 *
 * The throttling lives here, on the server, rather than in a browser: every client — a web
 * console, a softphone plugin, a telephony bridge — then gets the same behaviour and the same
 * cost profile, and a naive client cannot fire an LLM call per word.
 */
import { randomUUID } from "node:crypto";
import type { Collection, Logger, Store } from "../../vendor/arag-platform/src/index.ts";
import type { VoiceConfig } from "../config.ts";
import type { Citation, ProspectRecord } from "../types.ts";
import type { BriefRequest, BriefResult } from "./brief.ts";

export type Speaker = string;

export interface TranscriptEntry {
  /** Who spoke. Free-form so callers can use "caller"/"agent"/a diarisation label. */
  speaker: Speaker;
  text: string;
  ts: string;
  /** False for interim STT hypotheses, which are replaced by the next final chunk. */
  final: boolean;
}

export interface TranscriptChunk {
  speaker?: Speaker;
  text: string;
  ts?: string;
  final?: boolean;
}

export interface BriefSnapshot {
  version: number;
  at: string;
  brief: unknown;
  latencyMs: number;
}

export interface ListenStats {
  chunks: number;
  words: number;
  refreshes: number;
  /** Refreshes the throttle deliberately skipped (duplicate or too soon). */
  skipped: number;
  /** Refreshes that returned nothing usable (upstream error or empty brief). */
  failures: number;
  lastLatencyMs: number;
  p50LatencyMs: number;
  p95LatencyMs: number;
}

export interface ListenSession {
  id: string;
  createdAt: string;
  updatedAt: string;
  prospect: string;
  locale?: string;
  generative_model?: string;
  metadata?: Record<string, unknown>;
  status: "live" | "ended";
  endedAt?: string;
  transcript: TranscriptEntry[];
  brief: unknown | null;
  briefVersion: number;
  briefHistory: BriefSnapshot[];
  citations: Citation[];
  stats: ListenStats;
  /** Internal throttle state; never returned by the API. */
  throttle: { lastNorm: string; lastFireAt: number };
  latencies: number[];
}

/** What the API returns (the throttle bookkeeping stays server-side). */
export interface ListenSessionView {
  id: string;
  createdAt: string;
  updatedAt: string;
  prospect: string;
  locale?: string;
  generative_model?: string;
  metadata?: Record<string, unknown>;
  status: "live" | "ended";
  endedAt?: string;
  brief: unknown | null;
  briefVersion: number;
  citations: Citation[];
  stats: ListenStats;
  transcript: TranscriptEntry[];
  transcriptTotal: number;
}

/** The full record of one call, as `GET /api/v1/listen/sessions/{id}/export` returns it. */
export interface ListenSessionExport {
  id: string;
  createdAt: string;
  updatedAt: string;
  endedAt?: string;
  prospect: string;
  locale?: string;
  generative_model?: string;
  metadata?: Record<string, unknown>;
  status: "live" | "ended";
  durationSec: number;
  brief: unknown | null;
  briefVersion: number;
  briefHistory: BriefSnapshot[];
  citations: Citation[];
  stats: ListenStats;
  transcript: TranscriptEntry[];
}

export type ListenSortKey = "started" | "updated" | "refreshes" | "duration";

/** Filters behind the Conversations list. */
export interface ListenQuery {
  prospect?: string;
  status?: "live" | "ended";
  /** Free text over prospect, brief topic/summary and the transcript. */
  q?: string;
  /** ISO date-times bounding when the session started. */
  from?: string;
  to?: string;
  sort?: ListenSortKey;
  order?: "asc" | "desc";
  limit?: number;
  offset?: number;
}

export type ListenEvent =
  | { type: "transcript"; entries: TranscriptEntry[]; stats: ListenStats }
  | { type: "brief"; brief: unknown; version: number; citations: Citation[]; stats: ListenStats }
  | { type: "status"; status: "live" | "ended" | "refreshing" | "skipped"; reason?: string };

export interface ThrottleOptions {
  /** Words of the tail used as the retrieval query. */
  windowWords: number;
  /** Minimum gap between two refreshes for one session. */
  minGapMs: number;
  /** Below this many words there is not enough to ask about. */
  minWords: number;
  /** Similarity above which the window counts as "the same thing again". */
  jaccardMax: number;
}

export const DEFAULT_THROTTLE: ThrottleOptions = {
  windowWords: 28,
  minGapMs: 1500,
  minWords: 4,
  jaccardMax: 0.85,
};

export type ThrottleReason = "ok" | "too-few-words" | "too-soon" | "unchanged" | "too-similar";

export interface ThrottleDecision {
  refresh: boolean;
  reason: ThrottleReason;
  /** Normalised window, stored as the comparison baseline when a refresh happens. */
  norm: string;
  /** When `reason` is "too-soon", how long until a refresh would be allowed. */
  waitMs: number;
}

/** Last `n` words of a string. */
export function lastWords(text: string, n: number): string {
  return (text ?? "").trim().split(/\s+/).filter(Boolean).slice(-n).join(" ");
}

/** Lowercase, punctuation-free form used for comparing two windows. */
export function normWords(text: string): string {
  return (text ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Jaccard similarity over word sets — cheap, and good enough to spot "the same sentence again". */
export function jaccard(a: string, b: string): number {
  const A = new Set(a.split(" ").filter(Boolean));
  const B = new Set(b.split(" ").filter(Boolean));
  if (A.size === 0 || B.size === 0) return 0;
  let intersection = 0;
  for (const x of A) if (B.has(x)) intersection++;
  return intersection / (A.size + B.size - intersection);
}

/**
 * Decide whether the current window justifies another LLM call. Pure, so the policy is testable
 * without a clock, a store or a Knowledge Box.
 */
export function decideRefresh(
  window: string,
  state: { lastNorm: string; lastFireAt: number },
  now: number,
  opts: ThrottleOptions = DEFAULT_THROTTLE,
): ThrottleDecision {
  const norm = normWords(window);
  const words = norm.split(" ").filter(Boolean).length;
  if (words < opts.minWords) return { refresh: false, reason: "too-few-words", norm, waitMs: 0 };
  if (state.lastFireAt > 0 && now - state.lastFireAt < opts.minGapMs) {
    return { refresh: false, reason: "too-soon", norm, waitMs: opts.minGapMs - (now - state.lastFireAt) };
  }
  if (norm === state.lastNorm) return { refresh: false, reason: "unchanged", norm, waitMs: 0 };
  if (state.lastNorm && jaccard(norm, state.lastNorm) > opts.jaccardMax) {
    return { refresh: false, reason: "too-similar", norm, waitMs: 0 };
  }
  return { refresh: true, reason: "ok", norm, waitMs: 0 };
}

const MAX_TRANSCRIPT_ENTRIES = 400;
const MAX_TRANSCRIPT_CHARS = 20_000;
const MAX_CITATIONS = 12;
const MAX_BRIEF_HISTORY = 20;
const MAX_LATENCIES = 50;

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return Math.round(sorted[Math.max(0, idx)] ?? 0);
}

export interface ListenDeps {
  store: Store;
  log: Logger;
  voice: VoiceConfig;
  /** Resolve a prospect (throws ProspectNotFoundError for unknown keys). */
  prospect: (key: string) => ProspectRecord;
  /** Run one brief refresh — injected so the service is testable without ARAG. */
  brief: (req: BriefRequest, prospect: ProspectRecord) => Promise<BriefResult>;
  throttle?: Partial<ThrottleOptions>;
  /** Injectable clock (tests). */
  now?: () => number;
  /** Session cap in the store. */
  cap?: number;
}

type Listener = (event: ListenEvent) => void;

export class ListenService {
  private readonly col: Collection<ListenSession>;
  private readonly deps: ListenDeps;
  private readonly opts: ThrottleOptions;
  private readonly listeners = new Map<string, Set<Listener>>();
  private readonly inFlight = new Set<string>();
  private readonly timers = new Map<string, NodeJS.Timeout>();
  private readonly now: () => number;
  private readonly cap: number;

  constructor(deps: ListenDeps) {
    this.deps = deps;
    this.opts = { ...DEFAULT_THROTTLE, ...(deps.throttle ?? {}) };
    this.now = deps.now ?? (() => Date.now());
    this.cap = deps.cap ?? 200;
    this.col = deps.store.collection<ListenSession>("listen-sessions", { cap: this.cap });
    // A session left "live" by a restart cannot be refreshed again; close it honestly.
    for (const s of this.col.list({ filter: (x) => x.status === "live" })) {
      this.col.update(s.id, { status: "ended", endedAt: new Date().toISOString() });
    }
  }

  get size(): number {
    return this.col.size;
  }

  /**
   * Make room before creating a session. The store evicts strictly by age, which would happily
   * throw away a call that is still in progress, so ended sessions are retired first.
   */
  private pruneEnded(): void {
    const cap = this.cap;
    if (this.col.size < cap) return;
    const ended = this.col
      .list({ filter: (s) => s.status === "ended" })
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    let over = this.col.size - cap + 1;
    for (const s of ended) {
      if (over <= 0) break;
      this.col.delete(s.id);
      over--;
    }
    if (over > 0) {
      this.deps.log.warn("listen.sessions.full", {
        cap,
        live: this.col.size,
        message: "every stored session is still live; the oldest will be evicted",
      });
    }
  }

  /** Start a session for a prospect. Throws if the prospect is unknown. */
  create(input: {
    prospect: string;
    locale?: string;
    metadata?: Record<string, unknown>;
    generative_model?: string;
  }): ListenSessionView {
    const prospect = this.deps.prospect(input.prospect);
    this.pruneEnded();
    const session: ListenSession = {
      id: randomUUID(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      prospect: prospect.id,
      locale: input.locale ?? prospect.locale,
      generative_model: input.generative_model,
      metadata: input.metadata,
      status: "live",
      transcript: [],
      brief: null,
      briefVersion: 0,
      briefHistory: [],
      citations: [],
      stats: {
        chunks: 0,
        words: 0,
        refreshes: 0,
        skipped: 0,
        failures: 0,
        lastLatencyMs: 0,
        p50LatencyMs: 0,
        p95LatencyMs: 0,
      },
      throttle: { lastNorm: "", lastFireAt: 0 },
      latencies: [],
    };
    this.col.put(session);
    this.deps.log.info("listen.session.created", { id: session.id, prospect: session.prospect });
    return this.view(session);
  }

  get(id: string): ListenSession | undefined {
    return this.col.get(id);
  }

  list(opts: { prospect?: string; limit?: number } = {}): ListenSessionView[] {
    return this.col
      .list({ filter: (s) => !opts.prospect || s.prospect === opts.prospect, limit: opts.limit ?? 25 })
      .map((s) => this.view(s, 0));
  }

  /**
   * The Conversations list: filter, search, sort and page over stored sessions.
   *
   * Search covers what an operator actually remembers about a call — who it was for, what the
   * brief decided the topic was, and words that were said — rather than only the id.
   */
  query(opts: ListenQuery = {}): { items: ListenSessionView[]; total: number } {
    const needle = (opts.q ?? "").trim().toLowerCase();
    const from = opts.from ? Date.parse(opts.from) : Number.NaN;
    const to = opts.to ? Date.parse(opts.to) : Number.NaN;
    const matches = this.col.list().filter((s) => {
      if (opts.prospect && s.prospect !== opts.prospect) return false;
      if (opts.status && s.status !== opts.status) return false;
      const started = Date.parse(s.createdAt);
      if (!Number.isNaN(from) && started < from) return false;
      if (!Number.isNaN(to) && started > to) return false;
      return !needle || sessionHaystack(s).includes(needle);
    });
    const dir = opts.order === "asc" ? 1 : -1;
    const key = opts.sort ?? "started";
    matches.sort((a, b) => dir * (sortValue(a, key) - sortValue(b, key)));
    const offset = Math.max(0, opts.offset ?? 0);
    const limit = Math.max(1, Math.min(opts.limit ?? 25, 200));
    return {
      total: matches.length,
      items: matches.slice(offset, offset + limit).map((s) => this.view(s, 0)),
    };
  }

  /** The whole record of one call — what "export the conversation" means. */
  exportSession(id: string): ListenSessionExport {
    const s = this.require(id);
    return {
      id: s.id,
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
      endedAt: s.endedAt,
      prospect: s.prospect,
      locale: s.locale,
      generative_model: s.generative_model,
      metadata: s.metadata,
      status: s.status,
      durationSec: Math.max(
        0,
        Math.round((Date.parse(s.endedAt ?? s.updatedAt) - Date.parse(s.createdAt)) / 1000),
      ),
      brief: s.brief,
      briefVersion: s.briefVersion,
      briefHistory: s.briefHistory,
      citations: s.citations,
      stats: s.stats,
      transcript: s.transcript,
    };
  }

  /** The API projection: no throttle bookkeeping, transcript trimmed to a tail. */
  view(session: ListenSession, tail = 50): ListenSessionView {
    return {
      id: session.id,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      prospect: session.prospect,
      locale: session.locale,
      generative_model: session.generative_model,
      metadata: session.metadata,
      status: session.status,
      endedAt: session.endedAt,
      brief: session.brief,
      briefVersion: session.briefVersion,
      citations: session.citations,
      stats: session.stats,
      transcript: tail > 0 ? session.transcript.slice(-tail) : [],
      transcriptTotal: session.transcript.length,
    };
  }

  /** Admin projection: adds the brief history so an operator can see how it evolved. */
  adminView(session: ListenSession): ListenSessionView & { briefHistory: BriefSnapshot[] } {
    return { ...this.view(session, 20), briefHistory: session.briefHistory };
  }

  /** The transcript as plain text, oldest first, for the brief prompt. */
  transcriptText(session: ListenSession): string {
    return session.transcript
      .filter((t) => t.final)
      .map((t) => `${t.speaker}: ${t.text}`)
      .join("\n")
      .slice(-MAX_TRANSCRIPT_CHARS);
  }

  /** The rolling window the brief retrieves against: the tail of what was just said. */
  window(session: ListenSession): string {
    const recent = session.transcript
      .slice(-12)
      .map((t) => t.text)
      .join(" ");
    return lastWords(recent, this.opts.windowWords);
  }

  /**
   * Append transcript chunks. Interim (non-final) chunks replace the previous interim entry, so a
   * streaming STT that re-sends its hypothesis every 200 ms does not fill the transcript.
   * Returns what the throttle decided so callers can see why a refresh did or did not happen.
   */
  append(id: string, chunks: TranscriptChunk[]): { session: ListenSessionView; decision: ThrottleDecision } {
    const session = this.require(id);
    if (session.status === "ended") throw new ListenSessionEnded(id);
    const entries: TranscriptEntry[] = [];
    for (const chunk of chunks) {
      const text = (chunk.text ?? "").trim();
      if (!text) continue;
      const entry: TranscriptEntry = {
        speaker: (chunk.speaker ?? "caller").slice(0, 40),
        text,
        ts: chunk.ts ?? new Date().toISOString(),
        final: chunk.final !== false,
      };
      // Drop the previous interim hypothesis: only the latest one is meaningful.
      if (session.transcript.length && session.transcript[session.transcript.length - 1]?.final === false) {
        session.transcript.pop();
      }
      session.transcript.push(entry);
      entries.push(entry);
      session.stats.chunks++;
      session.stats.words += text.split(/\s+/).filter(Boolean).length;
    }
    if (session.transcript.length > MAX_TRANSCRIPT_ENTRIES) {
      session.transcript = session.transcript.slice(-MAX_TRANSCRIPT_ENTRIES);
    }

    const decision = decideRefresh(this.window(session), session.throttle, this.now(), this.opts);
    if (!decision.refresh && decision.reason !== "too-few-words") session.stats.skipped++;
    this.col.put(session);
    if (entries.length) this.emit(id, { type: "transcript", entries, stats: session.stats });

    if (decision.refresh) {
      void this.refresh(id, decision.norm);
    } else if (decision.reason === "too-soon") {
      // Coalesce: run once the minimum gap has elapsed rather than dropping the update.
      this.schedule(id, decision.waitMs);
    }
    return { session: this.view(this.require(id)), decision };
  }

  /** Schedule a deferred refresh (used when the throttle says "too soon"). */
  private schedule(id: string, waitMs: number): void {
    if (this.timers.has(id)) return;
    const timer = setTimeout(
      () => {
        this.timers.delete(id);
        const session = this.col.get(id);
        if (!session || session.status === "ended") return;
        const decision = decideRefresh(this.window(session), session.throttle, this.now(), this.opts);
        if (decision.refresh) void this.refresh(id, decision.norm);
      },
      Math.max(10, waitMs),
    );
    timer.unref?.();
    this.timers.set(id, timer);
  }

  /**
   * Run one brief refresh for a session. Never throws: a failed refresh leaves the previous brief
   * on screen, which is what a person watching a live call needs.
   */
  async refresh(id: string, norm?: string): Promise<ListenSessionView | undefined> {
    const session = this.col.get(id);
    if (!session || session.status === "ended") return undefined;
    if (this.inFlight.has(id)) return this.view(session);
    this.inFlight.add(id);
    const window = this.window(session);
    session.throttle = { lastNorm: norm ?? normWords(window), lastFireAt: this.now() };
    this.col.put(session);
    this.emit(id, { type: "status", status: "refreshing" });
    try {
      const prospect = this.deps.prospect(session.prospect);
      const result = await this.deps.brief(
        {
          text: window,
          transcript: this.transcriptText(session),
          prev: session.brief ?? undefined,
          model: session.generative_model,
        },
        prospect,
      );
      const current = this.col.get(id);
      if (!current) return undefined;
      current.stats.lastLatencyMs = result.latency_ms.total;
      current.latencies = [...current.latencies, result.latency_ms.total].slice(-MAX_LATENCIES);
      current.stats.p50LatencyMs = percentile(current.latencies, 50);
      current.stats.p95LatencyMs = percentile(current.latencies, 95);
      const usable = isUsableBrief(result.brief);
      if (usable) {
        current.brief = result.brief;
        current.briefVersion++;
        current.briefHistory = [
          ...current.briefHistory,
          {
            version: current.briefVersion,
            at: new Date().toISOString(),
            brief: result.brief,
            latencyMs: result.latency_ms.total,
          },
        ].slice(-MAX_BRIEF_HISTORY);
        current.citations = mergeCitations(current.citations, result.citations);
        current.stats.refreshes++;
      } else {
        current.stats.failures++;
      }
      this.col.put(current);
      if (usable) {
        this.emit(id, {
          type: "brief",
          brief: current.brief,
          version: current.briefVersion,
          citations: current.citations,
          stats: current.stats,
        });
      } else {
        this.emit(id, { type: "status", status: "skipped", reason: "nothing-relevant-yet" });
      }
      return this.view(current);
    } catch (err) {
      const current = this.col.get(id);
      if (current) {
        current.stats.failures++;
        this.col.put(current);
      }
      this.deps.log.warn("listen.refresh.failed", { id, message: (err as Error).message });
      this.emit(id, { type: "status", status: "skipped", reason: "refresh-failed" });
      return current ? this.view(current) : undefined;
    } finally {
      this.inFlight.delete(id);
    }
  }

  /** End a session. The brief, citations and stats are kept for review. */
  end(id: string): ListenSessionView {
    const session = this.require(id);
    const timer = this.timers.get(id);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(id);
    }
    if (session.status !== "ended") {
      session.status = "ended";
      session.endedAt = new Date().toISOString();
      this.col.put(session);
      this.deps.log.info("listen.session.ended", {
        id,
        prospect: session.prospect,
        refreshes: session.stats.refreshes,
        chunks: session.stats.chunks,
      });
    }
    this.emit(id, { type: "status", status: "ended" });
    return this.view(session);
  }

  /**
   * Delete a session and everything recorded with it: the transcript, the brief history and the
   * citations. An operator deleting a conversation means the conversation is gone, so the timer
   * is cleared and any open SSE subscriber is told the session ended before the record goes.
   */
  delete(id: string): boolean {
    const session = this.col.get(id);
    if (!session) return false;
    const timer = this.timers.get(id);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(id);
    }
    this.emit(id, { type: "status", status: "ended" });
    this.listeners.delete(id);
    const ok = this.col.delete(id);
    if (ok) this.deps.log.info("listen.session.deleted", { id, prospect: session.prospect });
    return ok;
  }

  /** Delete every session started before `cutoff` (retention). Returns how many went. */
  purgeBefore(cutoff: Date): number {
    let removed = 0;
    for (const s of this.col.list({ filter: (x) => x.createdAt < cutoff.toISOString() })) {
      if (this.delete(s.id)) removed++;
    }
    return removed;
  }

  /** Delete every stored session (the operator's danger zone). */
  purgeAll(): number {
    const ids = this.col.list().map((s) => s.id);
    for (const id of ids) this.delete(id);
    return ids.length;
  }

  require(id: string): ListenSession {
    const session = this.col.get(id);
    if (!session) throw new ListenSessionNotFound(id);
    return session;
  }

  subscribe(id: string, fn: Listener): () => void {
    let set = this.listeners.get(id);
    if (!set) {
      set = new Set();
      this.listeners.set(id, set);
    }
    set.add(fn);
    return () => {
      set?.delete(fn);
      if (set && set.size === 0) this.listeners.delete(id);
    };
  }

  private emit(id: string, event: ListenEvent): void {
    for (const fn of this.listeners.get(id) ?? []) {
      try {
        fn(event);
      } catch (err) {
        this.deps.log.warn("listen.listener.error", { id, message: (err as Error).message });
      }
    }
  }

  /** Stop timers (shutdown). */
  close(): void {
    for (const t of this.timers.values()) clearTimeout(t);
    this.timers.clear();
  }
}

/** Lowercased text a Conversations search runs against: who, what the brief said, what was said. */
export function sessionHaystack(s: ListenSession): string {
  const b = (s.brief ?? {}) as Record<string, unknown>;
  const briefText = ["topic", "summary", "their_goal", "caller_profile", "stage"]
    .map((k) => (typeof b[k] === "string" ? (b[k] as string) : ""))
    .join(" ");
  const transcript = s.transcript.map((t) => t.text).join(" ");
  const cites = s.citations.map((c) => c.title).join(" ");
  return `${s.id} ${s.prospect} ${briefText} ${cites} ${transcript}`.toLowerCase();
}

function sortValue(s: ListenSession, key: ListenSortKey): number {
  if (key === "updated") return Date.parse(s.updatedAt);
  if (key === "refreshes") return s.stats.refreshes;
  if (key === "duration") return Date.parse(s.endedAt ?? s.updatedAt) - Date.parse(s.createdAt);
  return Date.parse(s.createdAt);
}

/** A brief is worth showing when it carries something a person can read. */
export function isUsableBrief(brief: unknown): boolean {
  if (!brief || typeof brief !== "object") return false;
  const b = brief as Record<string, unknown>;
  const nonEmpty = (v: unknown) => typeof v === "string" && v.trim().length > 0;
  const list = (v: unknown) => Array.isArray(v) && v.some((x) => String(x ?? "").trim().length > 0);
  return nonEmpty(b.summary) || nonEmpty(b.caller_profile) || list(b.key_points) || list(b.suggested_answers);
}

/** Accumulate citations across a call: dedupe by title+url, keep the best score, newest first. */
export function mergeCitations(existing: Citation[], incoming: Citation[]): Citation[] {
  const byKey = new Map<string, Citation>();
  for (const c of [...incoming, ...existing]) {
    const title = (c.title ?? "").trim();
    if (!title) continue;
    const key = `${title}|${c.url ?? ""}`.toLowerCase();
    const prev = byKey.get(key);
    if (!prev) byKey.set(key, { title, url: c.url ?? "", score: c.score ?? 0 });
    else if ((c.score ?? 0) > prev.score) prev.score = c.score ?? 0;
  }
  return [...byKey.values()].slice(0, MAX_CITATIONS);
}

export class ListenSessionNotFound extends Error {
  readonly id: string;
  constructor(id: string) {
    super(`Listen session "${id}" not found`);
    this.name = "ListenSessionNotFound";
    this.id = id;
  }
}

export class ListenSessionEnded extends Error {
  readonly id: string;
  constructor(id: string) {
    super(`Listen session "${id}" has ended`);
    this.name = "ListenSessionEnded";
    this.id = id;
  }
}
