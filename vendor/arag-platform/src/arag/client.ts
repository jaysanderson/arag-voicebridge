/**
 * Typed client for the Progress Agentic RAG (ARAG / Nuclia) REST API.
 *
 * Design:
 *   - One class, one KB. Everything derives from `baseUrl` (…/api/v1) + `kbId`.
 *   - Auth header `X-NUCLIA-SERVICEACCOUNT: Bearer <apiKey>` (service-account token).
 *   - Every call has a timeout and an optional AbortSignal; errors are `AragError`.
 *   - `fetch` is injectable so tests and the mock server can run in-process.
 *   - No retries by default; `withRetry()` wraps idempotent reads.
 */
import { AragError } from "./errors.ts";
import { iterateAskStream } from "./ndjson.ts";
import type {
  AskRequest,
  AskResult,
  AskStreamItem,
  CatalogRequest,
  CatalogResponse,
  CreateResourceRequest,
  FindRequest,
  FindResponse,
  Labelset,
  LabelsetsResponse,
  ProcessingStatus,
  RemiRequest,
  RemiResponse,
  Resource,
  RetrievalResults,
  SearchConfiguration,
  TaskStartRequest,
  TaskStartResponse,
  TasksListResponse,
  UploadResult,
} from "./types.ts";

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface AragClientOptions {
  kbId: string;
  apiKey: string;
  /** Zone slug, used when `baseUrl` is not given. */
  region?: string;
  /** Full API base, e.g. https://aws-us-east-2-1.dp.progress.cloud/api/v1 (no trailing slash). */
  baseUrl?: string;
  /** Host template used with `region`; `{region}` is substituted. */
  hostTemplate?: string;
  timeoutMs?: number;
  fetch?: FetchLike;
  /** Optional hook for request logging/metrics (never receives the token). */
  onRequest?: (info: { method: string; path: string; status?: number; ms: number; error?: string }) => void;
  /** Extra default headers (e.g. X-NUCLIA-... audit). */
  headers?: Record<string, string>;
}

export const DEFAULT_HOST_TEMPLATE = "https://{region}.dp.progress.cloud/api/v1";

export function resolveBaseUrl(opts: { region?: string; baseUrl?: string; hostTemplate?: string }): string {
  if (opts.baseUrl) return opts.baseUrl.replace(/\/+$/, "");
  if (!opts.region) throw new Error("AragClient: either baseUrl or region is required");
  return (opts.hostTemplate ?? DEFAULT_HOST_TEMPLATE).replace("{region}", opts.region);
}

function b64(s: string): string {
  return Buffer.from(s, "utf8").toString("base64");
}

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(t);
        reject(new AragError("aborted", "aborted", "sleep"));
      },
      { once: true },
    );
  });

export class AragClient {
  readonly kbId: string;
  readonly baseUrl: string;
  readonly timeoutMs: number;
  private readonly apiKey: string;
  private readonly fetchImpl: FetchLike;
  private readonly onRequest: AragClientOptions["onRequest"];
  private readonly extraHeaders: Record<string, string>;

  constructor(opts: AragClientOptions) {
    if (!opts.kbId) throw new Error("AragClient: kbId is required");
    this.kbId = opts.kbId;
    this.apiKey = opts.apiKey ?? "";
    this.baseUrl = resolveBaseUrl(opts);
    this.timeoutMs = opts.timeoutMs ?? 60_000;
    this.fetchImpl = opts.fetch ?? ((input, init) => fetch(input, init));
    this.onRequest = opts.onRequest;
    this.extraHeaders = opts.headers ?? {};
  }

  /** `…/api/v1/kb/<kbId>` */
  get kbUrl(): string {
    return `${this.baseUrl}/kb/${this.kbId}`;
  }

  private headers(extra?: Record<string, string>): Record<string, string> {
    return { "X-NUCLIA-SERVICEACCOUNT": `Bearer ${this.apiKey}`, ...this.extraHeaders, ...extra };
  }

  /** Low-level request with timeout, abort and uniform error mapping. */
  async request(
    method: string,
    path: string,
    init: {
      body?: BodyInit | null;
      headers?: Record<string, string>;
      signal?: AbortSignal;
      timeoutMs?: number;
      raw?: boolean;
    } = {},
  ): Promise<Response> {
    const url = path.startsWith("http") ? path : `${this.kbUrl}${path}`;
    const timeout = AbortSignal.timeout(init.timeoutMs ?? this.timeoutMs);
    const signal = init.signal ? AbortSignal.any([init.signal, timeout]) : timeout;
    const started = performance.now();
    const op = `${method} ${path.split("?")[0]}`;
    let res: Response;
    try {
      res = await this.fetchImpl(url, {
        method,
        headers: this.headers(init.headers),
        body: init.body ?? undefined,
        signal,
      });
    } catch (err) {
      const ms = performance.now() - started;
      if (timeout.aborted) {
        this.onRequest?.({ method, path, ms, error: "timeout" });
        throw new AragError(
          `ARAG ${op} timed out after ${init.timeoutMs ?? this.timeoutMs} ms`,
          "timeout",
          op,
        );
      }
      if (init.signal?.aborted) {
        this.onRequest?.({ method, path, ms, error: "aborted" });
        throw new AragError(`ARAG ${op} aborted`, "aborted", op);
      }
      this.onRequest?.({ method, path, ms, error: "network" });
      throw new AragError(`ARAG ${op} network error: ${(err as Error).message}`, "network", op);
    }
    this.onRequest?.({ method, path, status: res.status, ms: performance.now() - started });
    if (!res.ok && !(init.raw && res.status === 206)) {
      const detail = await res.text().catch(() => "");
      throw new AragError(
        `ARAG ${op} failed with HTTP ${res.status}`,
        "http",
        op,
        res.status,
        detail.slice(0, 500),
      );
    }
    return res;
  }

  private async json<T>(
    method: string,
    path: string,
    body?: unknown,
    opts: { signal?: AbortSignal; timeoutMs?: number } = {},
  ): Promise<T> {
    const res = await this.request(method, path, {
      body: body === undefined ? null : JSON.stringify(body),
      headers: body === undefined ? {} : { "Content-Type": "application/json" },
      signal: opts.signal,
      timeoutMs: opts.timeoutMs,
    });
    const text = await res.text();
    if (!text) return {} as T;
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new AragError(
        `ARAG ${method} ${path} returned non-JSON`,
        "protocol",
        `${method} ${path}`,
        res.status,
        text.slice(0, 200),
      );
    }
  }

  // ───────────────────────────── resources ─────────────────────────────

  /** Simple (non-resumable) upload of raw bytes as a new resource. */
  async upload(
    bytes: Uint8Array | Buffer,
    filename: string,
    contentType: string,
    opts: { extractStrategy?: string; splitStrategy?: string; language?: string; signal?: AbortSignal } = {},
  ): Promise<UploadResult> {
    const q = new URLSearchParams();
    if (opts.extractStrategy) q.set("extract_strategy", opts.extractStrategy);
    if (opts.splitStrategy) q.set("split_strategy", opts.splitStrategy);
    const qs = q.toString();
    const headers: Record<string, string> = {
      "Content-Type": contentType || "application/octet-stream",
      "X-FILENAME": b64(filename),
    };
    if (opts.language) headers["X-LANGUAGE"] = opts.language;
    const res = await this.request("POST", `/upload${qs ? `?${qs}` : ""}`, {
      body: bytes as BodyInit,
      headers,
      signal: opts.signal,
    });
    const out = (await res.json()) as UploadResult;
    if (!out.uuid)
      throw new AragError("upload returned no resource uuid", "protocol", "POST /upload", res.status);
    return out;
  }

  /** Create a resource (metadata and/or text fields). Returns the uuid. */
  async createResource(
    body: CreateResourceRequest,
    opts: { signal?: AbortSignal } = {},
  ): Promise<{ uuid: string; seqid?: number }> {
    return this.json("POST", "/resources", body, opts);
  }

  /** Upload raw bytes into a file field of an existing resource. */
  async uploadFileField(
    rid: string,
    field: string,
    bytes: Uint8Array | Buffer,
    filename: string,
    contentType: string,
    opts: { language?: string; extractStrategy?: string; signal?: AbortSignal } = {},
  ): Promise<UploadResult> {
    const headers: Record<string, string> = { "Content-Type": contentType, "X-FILENAME": b64(filename) };
    if (opts.language) headers["X-LANGUAGE"] = opts.language;
    const q = opts.extractStrategy ? `?extract_strategy=${encodeURIComponent(opts.extractStrategy)}` : "";
    const res = await this.request("POST", `/resource/${rid}/file/${encodeURIComponent(field)}/upload${q}`, {
      body: bytes as BodyInit,
      headers,
      signal: opts.signal,
    });
    const text = await res.text();
    return text ? (JSON.parse(text) as UploadResult) : { uuid: rid, field_id: field };
  }

  async getResource(
    rid: string,
    opts: { show?: string[]; extracted?: string[]; fieldType?: string[]; signal?: AbortSignal } = {},
  ): Promise<Resource> {
    const q = new URLSearchParams();
    for (const s of opts.show ?? ["basic"]) q.append("show", s);
    for (const e of opts.extracted ?? []) q.append("extracted", e);
    for (const f of opts.fieldType ?? []) q.append("field_type", f);
    return this.json("GET", `/resource/${rid}?${q.toString()}`, undefined, opts);
  }

  async deleteResource(rid: string, opts: { signal?: AbortSignal } = {}): Promise<void> {
    await this.request("DELETE", `/resource/${rid}`, { signal: opts.signal });
  }

  /** Processing status of a resource (`PENDING` → `PROCESSED` | `ERROR`). */
  async status(rid: string, opts: { signal?: AbortSignal } = {}): Promise<ProcessingStatus> {
    const r = await this.getResource(rid, { show: ["basic"], signal: opts.signal });
    return r.metadata?.status ?? "UNKNOWN";
  }

  /** Poll until PROCESSED. Throws AragError(kind=timeout) on deadline, (kind=http) on ERROR. */
  async waitProcessed(
    rid: string,
    opts: {
      timeoutMs?: number;
      intervalMs?: number;
      onPoll?: (status: ProcessingStatus, attempt: number) => void;
      signal?: AbortSignal;
    } = {},
  ): Promise<ProcessingStatus> {
    const deadline = Date.now() + (opts.timeoutMs ?? 180_000);
    let attempt = 0;
    while (Date.now() < deadline) {
      attempt++;
      const status = await this.status(rid, { signal: opts.signal });
      opts.onPoll?.(status, attempt);
      if (status === "PROCESSED") return status;
      if (status === "ERROR")
        throw new AragError(`resource ${rid} processing ERROR`, "http", "waitProcessed");
      await sleep(opts.intervalMs ?? 2_500, opts.signal);
    }
    throw new AragError(`resource ${rid} not processed within deadline`, "timeout", "waitProcessed");
  }

  /** Is the resource retrievable yet? (cheap keyword /find). PROCESSED can precede searchability by seconds. */
  async isSearchable(rid: string, opts: { signal?: AbortSignal } = {}): Promise<boolean> {
    try {
      const r = await this.find(
        { query: "document", features: ["keyword"], resource_filters: [rid], top_k: 1 },
        opts,
      );
      return Boolean(r.resources && rid in r.resources);
    } catch {
      return false;
    }
  }

  async waitSearchable(
    rid: string,
    opts: {
      timeoutMs?: number;
      intervalMs?: number;
      onPoll?: (attempt: number) => void;
      signal?: AbortSignal;
    } = {},
  ): Promise<boolean> {
    const deadline = Date.now() + (opts.timeoutMs ?? 30_000);
    let attempt = 0;
    while (Date.now() < deadline) {
      attempt++;
      opts.onPoll?.(attempt);
      if (await this.isSearchable(rid, opts)) return true;
      await sleep(opts.intervalMs ?? 2_000, opts.signal);
    }
    return false;
  }

  /** Concatenated extracted text of all non-generic fields. */
  async extractedText(rid: string, opts: { signal?: AbortSignal } = {}): Promise<string> {
    const r = await this.getResource(rid, { show: ["extracted"], extracted: ["text"], signal: opts.signal });
    const parts: string[] = [];
    for (const [category, fields] of Object.entries(r.data ?? {})) {
      if (category === "generics" || !fields) continue;
      for (const f of Object.values(fields)) {
        const t = f?.extracted?.text?.text;
        if (typeof t === "string" && t.trim()) parts.push(t.trim());
      }
    }
    return parts.join("\n\n");
  }

  /** Stream a file field (forwards Range for seeking). Returns the raw upstream Response. */
  async downloadFileField(
    rid: string,
    field: string,
    opts: { range?: string | null; signal?: AbortSignal } = {},
  ): Promise<Response> {
    const headers: Record<string, string> = {};
    if (opts.range) headers.Range = opts.range;
    return this.request("GET", `/resource/${rid}/file/${encodeURIComponent(field)}/download/field`, {
      headers,
      signal: opts.signal,
      raw: true,
      timeoutMs: 10 * 60_000,
    });
  }

  // ───────────────────────────── search ─────────────────────────────

  async find(body: FindRequest, opts: { signal?: AbortSignal } = {}): Promise<FindResponse> {
    return this.json("POST", "/find", body, opts);
  }

  async catalog(body: CatalogRequest = {}, opts: { signal?: AbortSignal } = {}): Promise<CatalogResponse> {
    return this.json("POST", "/catalog", { page_size: 100, ...body }, opts);
  }

  /** All resource ids in the KB (paginates the catalog). */
  async listResourceIds(
    opts: { pageSize?: number; max?: number; signal?: AbortSignal } = {},
  ): Promise<string[]> {
    const ids: string[] = [];
    const pageSize = opts.pageSize ?? 100;
    for (let page = 0; page < 100; page++) {
      const c = await this.catalog({ page_number: page, page_size: pageSize }, opts);
      const batch = Object.keys(c.resources ?? {});
      ids.push(...batch);
      if (opts.max && ids.length >= opts.max) return ids.slice(0, opts.max);
      if (!c.fulltext?.next_page || batch.length === 0) break;
    }
    return ids;
  }

  // ───────────────────────────── ask ─────────────────────────────

  /**
   * Stream `/ask` as normalised items. Callers that just want the assembled answer use `ask()`.
   * Note: ARAG rejects `citations` together with `answer_json_schema`; this method drops
   * `citations` automatically in that case.
   */
  async *askStream(
    body: AskRequest,
    opts: { signal?: AbortSignal; timeoutMs?: number; resourceId?: string } = {},
  ): AsyncGenerator<AskStreamItem> {
    const req: AskRequest = { features: ["keyword", "semantic"], ...body };
    if (req.answer_json_schema && req.citations) delete req.citations;
    const path = opts.resourceId ? `/resource/${opts.resourceId}/ask` : "/ask";
    const res = await this.request("POST", path, {
      body: JSON.stringify(req),
      headers: { "Content-Type": "application/json", Accept: "application/x-ndjson" },
      signal: opts.signal,
      timeoutMs: opts.timeoutMs,
    });
    if (!res.body) throw new AragError("ask returned no body", "protocol", "POST /ask", res.status);
    try {
      yield* iterateAskStream(res.body);
    } catch (err) {
      if (err instanceof AragError) throw err;
      if (opts.signal?.aborted) throw new AragError("ask stream aborted", "aborted", "POST /ask");
      throw new AragError(`ask stream error: ${(err as Error).message}`, "network", "POST /ask");
    }
  }

  /** Full `/ask` round-trip, assembled. */
  async ask(
    body: AskRequest,
    opts: {
      signal?: AbortSignal;
      timeoutMs?: number;
      resourceId?: string;
      onItem?: (item: AskStreamItem) => void;
    } = {},
  ): Promise<AskResult> {
    const started = performance.now();
    const result: AskResult = {
      answerText: "",
      answerJson: undefined,
      retrieval: {},
      citations: {},
      sourceTitles: [],
      status: undefined,
      errorDetail: undefined,
      metadata: undefined,
      timings: { firstTokenMs: 0, retrieveMs: 0, totalMs: 0 },
      items: [],
    };
    const titles = new Set<string>();
    for await (const item of this.askStream(body, opts)) {
      result.items.push(item);
      opts.onItem?.(item);
      switch (item.type) {
        case "answer":
          if (item.text) {
            if (!result.timings.firstTokenMs)
              result.timings.firstTokenMs = Math.round(performance.now() - started);
            result.answerText += item.text;
          }
          break;
        case "answer_json":
          result.answerJson = (item as { object: unknown }).object;
          break;
        case "retrieval": {
          if (!result.timings.retrieveMs) result.timings.retrieveMs = Math.round(performance.now() - started);
          const results = (item as { results: RetrievalResults }).results;
          result.retrieval = results;
          for (const r of Object.values(results.resources ?? {}))
            if (r?.title?.trim()) titles.add(r.title.trim());
          break;
        }
        case "citations":
          result.citations = (item as { citations: Record<string, Array<[number, number]>> }).citations ?? {};
          break;
        case "metadata":
          result.metadata = item as Record<string, unknown>;
          break;
        case "status":
          result.status = String(
            (item as Record<string, unknown>).status ?? (item as Record<string, unknown>).code ?? "",
          );
          if ((item as Record<string, unknown>).details)
            result.errorDetail = String((item as Record<string, unknown>).details);
          break;
        case "error":
          result.status = "error";
          result.errorDetail = String(
            (item as Record<string, unknown>).error ?? (item as Record<string, unknown>).details ?? "",
          );
          break;
        default:
          break;
      }
    }
    // Some models return structured JSON as text when the schema was honoured but not typed.
    if (
      body.answer_json_schema &&
      result.answerJson === undefined &&
      result.answerText.trim().startsWith("{")
    ) {
      try {
        result.answerJson = JSON.parse(result.answerText);
      } catch {
        /* leave as text */
      }
    }
    result.answerText = result.answerText.trim();
    result.sourceTitles = [...titles];
    result.timings.totalMs = Math.round(performance.now() - started);
    return result;
  }

  // ───────────────────────────── configuration ─────────────────────────────

  /** Create/replace a stored search configuration (`kind: ask|find`). Idempotent: 409 is treated as success. */
  async putSearchConfiguration(
    name: string,
    body: SearchConfiguration,
    opts: { signal?: AbortSignal } = {},
  ): Promise<void> {
    try {
      await this.request("POST", `/search_configurations/${encodeURIComponent(name)}`, {
        body: JSON.stringify(body),
        headers: { "Content-Type": "application/json" },
        signal: opts.signal,
      });
    } catch (err) {
      if (err instanceof AragError && err.status === 409) {
        await this.request("PATCH", `/search_configurations/${encodeURIComponent(name)}`, {
          body: JSON.stringify(body),
          headers: { "Content-Type": "application/json" },
          signal: opts.signal,
        }).catch(() => undefined);
        return;
      }
      throw err;
    }
  }

  async getSearchConfiguration(
    name: string,
    opts: { signal?: AbortSignal } = {},
  ): Promise<SearchConfiguration> {
    return this.json("GET", `/search_configurations/${encodeURIComponent(name)}`, undefined, opts);
  }

  async listSearchConfigurations(
    opts: { signal?: AbortSignal } = {},
  ): Promise<Record<string, SearchConfiguration>> {
    return this.json("GET", "/search_configurations", undefined, opts);
  }

  async deleteSearchConfiguration(name: string, opts: { signal?: AbortSignal } = {}): Promise<void> {
    await this.request("DELETE", `/search_configurations/${encodeURIComponent(name)}`, {
      signal: opts.signal,
    }).catch((err) => {
      if (err instanceof AragError && err.status === 404) return;
      throw err;
    });
  }

  /** KB configuration (contains `generative_model` etc.). */
  async getConfiguration(opts: { signal?: AbortSignal } = {}): Promise<Record<string, unknown>> {
    return this.json("GET", "/configuration", undefined, opts);
  }

  /** Learning-configuration schema (lists available generative models). */
  async getSchema(opts: { signal?: AbortSignal } = {}): Promise<Record<string, unknown>> {
    return this.json("GET", "/schema", undefined, opts);
  }

  // ───────────────────────────── labels ─────────────────────────────

  async listLabelsets(opts: { signal?: AbortSignal } = {}): Promise<LabelsetsResponse> {
    const r = await this.json<LabelsetsResponse>("GET", "/labelsets", undefined, opts);
    return { labelsets: r.labelsets ?? {} };
  }

  async putLabelset(id: string, body: Labelset, opts: { signal?: AbortSignal } = {}): Promise<void> {
    await this.request("POST", `/labelset/${encodeURIComponent(id)}`, {
      body: JSON.stringify(body),
      headers: { "Content-Type": "application/json" },
      signal: opts.signal,
    });
  }

  async deleteLabelset(id: string, opts: { signal?: AbortSignal } = {}): Promise<void> {
    await this.request("DELETE", `/labelset/${encodeURIComponent(id)}`, { signal: opts.signal }).catch(
      (err) => {
        if (err instanceof AragError && err.status === 404) return;
        throw err;
      },
    );
  }

  // ───────────────────────────── data augmentation tasks ─────────────────────────────

  async listTasks(opts: { signal?: AbortSignal } = {}): Promise<TasksListResponse> {
    return this.json("GET", "/tasks", undefined, opts);
  }

  async startTask(body: TaskStartRequest, opts: { signal?: AbortSignal } = {}): Promise<TaskStartResponse> {
    return this.json("POST", "/task/start", body, opts);
  }

  async deleteTask(id: string, opts: { signal?: AbortSignal } = {}): Promise<void> {
    await this.request("DELETE", `/task/${encodeURIComponent(id)}`, { signal: opts.signal }).catch((err) => {
      if (err instanceof AragError && err.status === 404) return;
      throw err;
    });
  }

  /** Wait until no task is running (ARAG allows one running task per operation type). */
  async waitTasksIdle(
    opts: { timeoutMs?: number; intervalMs?: number; graceMs?: number; signal?: AbortSignal } = {},
  ): Promise<boolean> {
    await sleep(opts.graceMs ?? 5_000, opts.signal);
    const deadline = Date.now() + (opts.timeoutMs ?? 8 * 60_000);
    while (Date.now() < deadline) {
      const t = await this.listTasks(opts);
      const running = (t.running ?? []).filter((x) => !x.stopped);
      if (running.length === 0) return true;
      await sleep(opts.intervalMs ?? 6_000, opts.signal);
    }
    return false;
  }

  // ───────────────────────────── predict ─────────────────────────────

  /** REMi answer-quality scoring against retrieved contexts. */
  async remi(body: RemiRequest, opts: { signal?: AbortSignal } = {}): Promise<RemiResponse> {
    return this.json(
      "POST",
      "/predict/remi",
      { ...body, contexts: body.contexts.slice(0, 20).map((c) => c.slice(0, 2000)) },
      opts,
    );
  }

  // ───────────────────────────── health ─────────────────────────────

  /** Connection test used by admin panels: cheap catalog read + configuration. */
  async health(opts: { signal?: AbortSignal } = {}): Promise<{
    ok: boolean;
    kbId: string;
    baseUrl: string;
    resources?: number;
    generativeModel?: string;
    error?: string;
    ms: number;
  }> {
    const t0 = performance.now();
    try {
      const [cat, cfg] = await Promise.all([
        this.catalog({ page_size: 1 }, opts),
        this.getConfiguration(opts).catch(() => ({}) as Record<string, unknown>),
      ]);
      return {
        ok: true,
        kbId: this.kbId,
        baseUrl: this.baseUrl,
        resources: cat.fulltext?.total ?? Object.keys(cat.resources ?? {}).length,
        generativeModel: typeof cfg.generative_model === "string" ? cfg.generative_model : undefined,
        ms: Math.round(performance.now() - t0),
      };
    } catch (err) {
      return {
        ok: false,
        kbId: this.kbId,
        baseUrl: this.baseUrl,
        error: (err as Error).message,
        ms: Math.round(performance.now() - t0),
      };
    }
  }
}

/** Retry an idempotent operation on retryable AragErrors with exponential backoff. */
export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: { attempts?: number; baseMs?: number; signal?: AbortSignal } = {},
): Promise<T> {
  const attempts = opts.attempts ?? 3;
  let last: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      last = err;
      if (!(err instanceof AragError) || !err.retryable || i === attempts - 1) throw err;
      await sleep((opts.baseMs ?? 300) * 2 ** i, opts.signal);
    }
  }
  throw last;
}
