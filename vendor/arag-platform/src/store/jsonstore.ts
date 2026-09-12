/**
 * Tiny durable collection store: one JSON file per collection under DATA_DIR, atomic writes,
 * in-memory index. Good for MVP-scale state (jobs, records, configs, registries). The interface
 * is small so it can be swapped for Postgres/Redis at GA.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export interface StoredDoc {
  id: string;
  createdAt: string;
  updatedAt: string;
}

export interface CollectionOptions {
  /** Max documents kept (oldest evicted). 0 = unlimited. */
  cap?: number;
  /** Persist to disk (default true). */
  persist?: boolean;
}

export class Collection<T extends StoredDoc> {
  readonly name: string;
  readonly file: string;
  private readonly docs = new Map<string, T>();
  private readonly cap: number;
  private readonly persist: boolean;
  private dirty = false;
  private flushTimer: NodeJS.Timeout | null = null;

  constructor(dir: string, name: string, opts: CollectionOptions = {}) {
    this.name = name;
    this.file = join(dir, `${name}.json`);
    this.cap = opts.cap ?? 0;
    this.persist = opts.persist ?? true;
    if (this.persist) {
      mkdirSync(dir, { recursive: true });
      if (existsSync(this.file)) {
        try {
          const arr = JSON.parse(readFileSync(this.file, "utf8")) as T[];
          for (const d of arr) this.docs.set(d.id, d);
        } catch {
          // corrupt file: start empty but keep a backup
          try {
            renameSync(this.file, `${this.file}.corrupt-${Date.now()}`);
          } catch {
            /* ignore */
          }
        }
      }
    }
  }

  get size(): number {
    return this.docs.size;
  }

  get(id: string): T | undefined {
    return this.docs.get(id);
  }

  has(id: string): boolean {
    return this.docs.has(id);
  }

  list(
    opts: { filter?: (d: T) => boolean; sort?: (a: T, b: T) => number; offset?: number; limit?: number } = {},
  ): T[] {
    let rows = [...this.docs.values()];
    if (opts.filter) rows = rows.filter(opts.filter);
    rows.sort(opts.sort ?? ((a, b) => b.createdAt.localeCompare(a.createdAt)));
    const off = opts.offset ?? 0;
    return opts.limit === undefined ? rows.slice(off) : rows.slice(off, off + opts.limit);
  }

  /** Insert or replace. Sets timestamps. */
  put(doc: Omit<T, "createdAt" | "updatedAt"> & Partial<StoredDoc>): T {
    const now = new Date().toISOString();
    const prev = this.docs.get(doc.id);
    const full = { ...doc, createdAt: prev?.createdAt ?? doc.createdAt ?? now, updatedAt: now } as T;
    this.docs.set(full.id, full);
    if (this.cap > 0 && this.docs.size > this.cap) {
      const oldest = [...this.docs.values()]
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
        .slice(0, this.docs.size - this.cap);
      for (const o of oldest) this.docs.delete(o.id);
    }
    this.scheduleFlush();
    return full;
  }

  update(id: string, patch: Partial<T> | ((d: T) => T)): T | undefined {
    const prev = this.docs.get(id);
    if (!prev) return undefined;
    const next = typeof patch === "function" ? patch(prev) : ({ ...prev, ...patch } as T);
    return this.put(next);
  }

  delete(id: string): boolean {
    const ok = this.docs.delete(id);
    if (ok) this.scheduleFlush();
    return ok;
  }

  clear(): void {
    this.docs.clear();
    this.scheduleFlush();
  }

  private scheduleFlush(): void {
    this.dirty = true;
    if (!this.persist || this.flushTimer) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      this.flush();
    }, 50);
    this.flushTimer.unref?.();
  }

  /** Write to disk now (atomic rename). */
  flush(): void {
    if (!this.persist || !this.dirty) return;
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, JSON.stringify([...this.docs.values()]));
    renameSync(tmp, this.file);
    this.dirty = false;
  }
}

const stores = new Set<Store>();
let exitHookInstalled = false;
function installExitHook(): void {
  if (exitHookInstalled) return;
  exitHookInstalled = true;
  const flush = () => {
    for (const s of stores) {
      try {
        s.flushAll();
      } catch {
        /* best effort */
      }
    }
  };
  process.on("beforeExit", flush);
  process.on("exit", flush);
  for (const sig of ["SIGINT", "SIGTERM"] as const) {
    process.on(sig, () => {
      flush();
      process.exit(sig === "SIGINT" ? 130 : 143);
    });
  }
}

export class Store {
  readonly dir: string;
  private readonly collections = new Map<string, Collection<StoredDoc>>();
  readonly persist: boolean;

  constructor(dir: string, opts: { persist?: boolean } = {}) {
    this.dir = dir;
    this.persist = opts.persist ?? true;
    if (this.persist) {
      mkdirSync(dir, { recursive: true });
      stores.add(this);
      installExitHook();
    }
  }

  collection<T extends StoredDoc>(name: string, opts: CollectionOptions = {}): Collection<T> {
    let c = this.collections.get(name);
    if (!c) {
      c = new Collection<StoredDoc>(this.dir, name, { persist: this.persist, ...opts });
      this.collections.set(name, c);
    }
    return c as unknown as Collection<T>;
  }

  flushAll(): void {
    for (const c of this.collections.values()) c.flush();
  }

  /** Disk usage summary for admin panels. */
  stats(): Record<string, { count: number; file: string }> {
    const out: Record<string, { count: number; file: string }> = {};
    for (const [n, c] of this.collections) out[n] = { count: c.size, file: c.file };
    return out;
  }
}
