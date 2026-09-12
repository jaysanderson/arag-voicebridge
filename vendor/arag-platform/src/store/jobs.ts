/**
 * JobManager — async work with progress events, SSE fan-out, cancellation and persistence.
 * Products wrap long ARAG pipelines (document processing, provisioning, golden evals) as jobs.
 */
import { randomUUID } from "node:crypto";
import type { Logger } from "../log/logger.ts";
import type { Collection, Store } from "./jsonstore.ts";

export type JobStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled";
export type EventStatus = "start" | "progress" | "ok" | "error" | "skip";

export interface JobEvent {
  ts: string;
  stage: string;
  status: EventStatus;
  message?: string;
  ms?: number;
  data?: unknown;
}

export interface Job<I = unknown, R = unknown> {
  id: string;
  kind: string;
  status: JobStatus;
  progress: number;
  stage?: string;
  message?: string;
  input: I;
  result?: R;
  error?: { message: string; kind?: string };
  events: JobEvent[];
  durationsMs: Record<string, number>;
  createdAt: string;
  updatedAt: string;
  finishedAt?: string;
  /** Product-specific link (e.g. document id). */
  ref?: string;
}

export interface JobContext<I> {
  job: Job<I>;
  signal: AbortSignal;
  log: Logger;
  /** Emit a stage event and update the job. */
  emit(
    stage: string,
    status: EventStatus,
    extra?: { message?: string; ms?: number; data?: unknown; progress?: number },
  ): void;
  /** Run and time a stage; errors are recorded (and rethrown unless `soft`). */
  stage<T>(
    name: string,
    message: string,
    fn: () => Promise<T>,
    opts?: { soft?: boolean; progress?: number },
  ): Promise<T | undefined>;
  /** Throw if cancelled. */
  check(): void;
}

export type JobRunner<I, R> = (ctx: JobContext<I>) => Promise<R>;

type Listener = (event: JobEvent | { stage: "job"; status: JobStatus; job: Job }) => void;

export class JobManager {
  private readonly col: Collection<Job>;
  private readonly runners = new Map<string, JobRunner<unknown, unknown>>();
  private readonly controllers = new Map<string, AbortController>();
  private readonly listeners = new Map<string, Set<Listener>>();
  private readonly log: Logger;
  private readonly maxEvents: number;
  private running = 0;
  private readonly concurrency: number;
  private readonly queue: string[] = [];

  constructor(
    store: Store,
    log: Logger,
    opts: { cap?: number; maxEvents?: number; concurrency?: number } = {},
  ) {
    this.col = store.collection<Job>("jobs", { cap: opts.cap ?? 500 });
    this.log = log;
    this.maxEvents = opts.maxEvents ?? 200;
    this.concurrency = opts.concurrency ?? 4;
    // Jobs left "running" by a crash are marked failed on boot.
    for (const j of this.col.list({ filter: (j) => j.status === "running" || j.status === "queued" })) {
      this.col.update(j.id, {
        status: "failed",
        error: { message: "interrupted by restart", kind: "restart" },
        finishedAt: new Date().toISOString(),
      });
    }
  }

  register<I, R>(kind: string, runner: JobRunner<I, R>): void {
    this.runners.set(kind, runner as JobRunner<unknown, unknown>);
  }

  get(id: string): Job | undefined {
    return this.col.get(id);
  }

  list(
    opts: { kind?: string; status?: JobStatus; limit?: number; offset?: number; ref?: string } = {},
  ): Job[] {
    return this.col.list({
      filter: (j) =>
        (!opts.kind || j.kind === opts.kind) &&
        (!opts.status || j.status === opts.status) &&
        (!opts.ref || j.ref === opts.ref),
      limit: opts.limit,
      offset: opts.offset,
    });
  }

  count(opts: { kind?: string; status?: JobStatus } = {}): number {
    return this.list({ ...opts }).length;
  }

  /** Create and enqueue a job; resolves immediately with the queued job. */
  submit<I>(kind: string, input: I, opts: { ref?: string; id?: string } = {}): Job<I> {
    if (!this.runners.has(kind)) throw new Error(`No runner registered for job kind "${kind}"`);
    const now = new Date().toISOString();
    const job: Job<I> = {
      id: opts.id ?? randomUUID(),
      kind,
      status: "queued",
      progress: 0,
      input,
      events: [],
      durationsMs: {},
      createdAt: now,
      updatedAt: now,
      ref: opts.ref,
    };
    this.col.put(job as Job);
    this.queue.push(job.id);
    queueMicrotask(() => this.pump());
    return job;
  }

  /** Submit and wait for completion (tests, CLIs). */
  async run<I, R>(kind: string, input: I, opts: { ref?: string } = {}): Promise<Job<I, R>> {
    const job = this.submit(kind, input, opts);
    return new Promise((resolveP) => {
      const done = (j: Job) => ["succeeded", "failed", "cancelled"].includes(j.status);
      const current = this.get(job.id);
      if (current && done(current)) return resolveP(current as Job<I, R>);
      const unsub = this.subscribe(job.id, (e) => {
        if (e.stage === "job" && "job" in e && done(e.job)) {
          unsub();
          resolveP(e.job as Job<I, R>);
        }
      });
    });
  }

  cancel(id: string): boolean {
    const job = this.col.get(id);
    if (!job || ["succeeded", "failed", "cancelled"].includes(job.status)) return false;
    const idx = this.queue.indexOf(id);
    if (idx !== -1) this.queue.splice(idx, 1);
    this.controllers.get(id)?.abort();
    this.finish(id, "cancelled", { message: "cancelled" });
    return true;
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

  private notify(id: string, e: Parameters<Listener>[0]): void {
    for (const fn of this.listeners.get(id) ?? []) {
      try {
        fn(e);
      } catch (err) {
        this.log.warn("job.listener.error", { id, message: (err as Error).message });
      }
    }
  }

  private pump(): void {
    while (this.running < this.concurrency && this.queue.length) {
      const id = this.queue.shift()!;
      const job = this.col.get(id);
      if (!job || job.status !== "queued") continue;
      this.running++;
      this.execute(job).finally(() => {
        this.running--;
        this.pump();
      });
    }
  }

  private finish(id: string, status: JobStatus, patch: Partial<Job> & { message?: string }): void {
    const job = this.col.update(id, (j) => ({
      ...j,
      ...patch,
      status,
      progress: status === "succeeded" ? 1 : j.progress,
      finishedAt: new Date().toISOString(),
    }));
    this.controllers.delete(id);
    if (job) this.notify(id, { stage: "job", status, job });
  }

  private async execute(job: Job): Promise<void> {
    const runner = this.runners.get(job.kind)!;
    const controller = new AbortController();
    this.controllers.set(job.id, controller);
    const log = this.log.child({ jobId: job.id, kind: job.kind });
    this.col.update(job.id, { status: "running" });
    this.notify(job.id, { stage: "job", status: "running", job: this.col.get(job.id)! });
    const emit: JobContext<unknown>["emit"] = (stage, status, extra = {}) => {
      const current = this.col.get(job.id);
      if (!current || current.finishedAt) return; // late events after finish/cancel are dropped
      const ev: JobEvent = {
        ts: new Date().toISOString(),
        stage,
        status,
        message: extra.message,
        ms: extra.ms,
        data: extra.data,
      };
      this.col.update(job.id, (j) => {
        const events = [...j.events, ev].slice(-this.maxEvents);
        if (extra.ms !== undefined && status !== "start") j.durationsMs[stage] = extra.ms;
        return {
          ...j,
          events,
          stage,
          message: extra.message ?? j.message,
          progress: extra.progress ?? j.progress,
        };
      });
      this.notify(job.id, ev);
    };
    const ctx: JobContext<unknown> = {
      job,
      signal: controller.signal,
      log,
      emit,
      check() {
        if (controller.signal.aborted) throw new Error("cancelled");
      },
      async stage(name, message, fn, opts = {}) {
        ctx.check();
        emit(name, "start", { message });
        const t0 = performance.now();
        try {
          const out = await fn();
          emit(name, "ok", { ms: Math.round(performance.now() - t0), progress: opts.progress });
          return out;
        } catch (err) {
          const ms = Math.round(performance.now() - t0);
          emit(name, "error", { ms, message: (err as Error).message });
          log.warn("job.stage.error", { stage: name, message: (err as Error).message });
          if (opts.soft) return undefined;
          throw err;
        }
      },
    };
    try {
      const result = await runner(ctx);
      if (controller.signal.aborted) return;
      this.finish(job.id, "succeeded", { result });
    } catch (err) {
      if (controller.signal.aborted) return;
      const e = err as { message: string; kind?: string };
      log.error("job.failed", { message: e.message });
      this.finish(job.id, "failed", { error: { message: e.message, kind: e.kind } });
    }
  }
}
