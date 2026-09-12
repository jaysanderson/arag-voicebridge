/**
 * Mock ARAG (Nuclia) server — an in-process, deterministic stand-in for a Knowledge Box.
 *
 * It implements the subset of the REST API the products use with realistic shapes:
 * upload / resources / resource (show, extracted) / delete / file download (Range) / find /
 * catalog / ask (NDJSON, answer_json_schema, citations, full_resource) / search_configurations /
 * labelsets / tasks (labeler + ask data-augmentation, applied immediately) / predict/remi /
 * configuration / schema. Auth header is checked when `apiKey` is set.
 *
 * Start with `startMockArag()` (tests, `ARAG_MOCK=1`) or `node src/arag/mock/cli.ts`.
 */
import { randomUUID } from "node:crypto";
import { readEnv } from "../../config/env.ts";
import { App, type Ctx } from "../../http/app.ts";
import { badRequest, HttpError, notFound } from "../../http/problem.ts";
import { Logger } from "../../log/logger.ts";
import { toNdjsonLine } from "../ndjson.ts";
import type { AskRequest, Labelset, ParagraphMeta, ResourceSummary } from "../types.ts";
import {
  callAnalysisFixture,
  callMetricsFixture,
  SAMPLE_CALL_TRANSCRIPT,
  sampleTextFor,
  synthesizeJson,
} from "./fixtures.ts";

export interface MockField {
  kind: "file" | "text";
  filename?: string;
  contentType?: string;
  bytes?: Buffer;
  body?: string;
  format?: string;
  text: string;
  paragraphs: ParagraphMeta[];
  classifications: Array<{ labelset: string; label: string }>;
}

export interface MockResource {
  id: string;
  slug?: string;
  title: string;
  icon: string;
  created: string;
  modified: string;
  origin?: Record<string, unknown>;
  extra?: { metadata?: Record<string, unknown> };
  usermetadata?: { classifications?: Array<{ labelset: string; label: string }> };
  status: "PENDING" | "PROCESSED" | "ERROR";
  processedAt: number;
  fields: Record<string, MockField>;
  computed: Array<{ labelset: string; label: string }>;
}

export interface MockOptions {
  kbId?: string;
  apiKey?: string;
  /** ms a fresh resource stays PENDING (default 0 → PROCESSED immediately). */
  processingMs?: number;
  /** Extra ms before a resource becomes searchable after PROCESSED (default 0). */
  searchableLagMs?: number;
  /** Per-chunk delay while streaming answers (default 0). */
  streamDelayMs?: number;
  /** Seed resources on start. */
  seed?: Array<
    Partial<MockResource> & {
      title: string;
      text?: string;
      transcript?: string;
      contentType?: string;
      filename?: string;
      metadata?: Record<string, unknown>;
      created?: string;
    }
  >;
  /** Default generative model name reported by /configuration. */
  generativeModel?: string;
  /** Route "ask" through this hook to customise answers in tests. */
  answerHook?: (
    req: AskRequest,
    ctx: { text: string; resources: MockResource[] },
  ) => { answer?: string; answerJson?: unknown } | null;
  log?: Logger;
}

export interface MockAragServer {
  app: App;
  mock: MockArag;
  url: string; // base URL …/api/v1
  kbId: string;
  apiKey: string;
  close(): Promise<void>;
}

const sleep = (ms: number) => (ms > 0 ? new Promise((r) => setTimeout(r, ms)) : Promise.resolve());

const STOP = new Set([
  "the",
  "and",
  "for",
  "that",
  "this",
  "with",
  "was",
  "are",
  "you",
  "your",
  "what",
  "how",
  "does",
  "did",
  "have",
  "has",
  "from",
  "about",
  "tell",
  "please",
  "can",
  "which",
  "who",
  "when",
  "where",
  "there",
  "here",
  "all",
  "any",
  "our",
]);
function tokens(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9$€£.]+/g, " ")
    .split(" ")
    .filter((t) => t.length > 2 && !STOP.has(t));
}

function looksText(bytes: Buffer): boolean {
  const sample = bytes.subarray(0, 512);
  let bad = 0;
  for (const b of sample) if (b === 0 || (b < 9 && b !== 0) || (b > 13 && b < 32)) bad++;
  return sample.length > 0 && bad / sample.length < 0.05;
}

/** Split text into paragraphs with char offsets. Transcripts ("Speaker: …" lines) get timestamps. */
export function paragraphsFor(text: string, transcript: boolean): ParagraphMeta[] {
  const out: ParagraphMeta[] = [];
  const re = /[^\n]+(?:\n(?!\n)[^\n]+)*/g; // blocks separated by blank lines
  let i = 0;
  for (const m of text.matchAll(re)) {
    const start = m.index ?? 0;
    const end = start + m[0].length;
    if (!m[0].trim()) continue;
    const p: ParagraphMeta = { start, end, kind: transcript ? "TRANSCRIPT" : "TEXT", classifications: [] };
    if (transcript) {
      p.start_seconds = [i * 6];
      p.end_seconds = [i * 6 + 5.5];
    }
    out.push(p);
    i++;
  }
  return out;
}

export class MockArag {
  readonly kbId: string;
  readonly apiKey: string;
  readonly opts: MockOptions;
  readonly resources = new Map<string, MockResource>();
  readonly labelsets = new Map<string, Labelset>();
  readonly searchConfigs = new Map<string, Record<string, unknown>>();
  readonly tasks: {
    configs: Array<Record<string, unknown>>;
    running: Array<Record<string, unknown>>;
    done: Array<Record<string, unknown>>;
  } = { configs: [], running: [], done: [] };
  /** Every request, for assertions in tests. */
  readonly calls: Array<{ method: string; path: string; body?: unknown }> = [];
  readonly log: Logger;

  constructor(opts: MockOptions = {}) {
    this.opts = opts;
    this.kbId = opts.kbId ?? "00000000-0000-4000-8000-00000000mock".replace("mock", "0001");
    this.apiKey = opts.apiKey ?? "mock-api-key";
    this.log = opts.log ?? new Logger({ level: "warn", ringSize: 0 });
    for (const s of opts.seed ?? []) this.seedResource(s);
  }

  // ───────────── state helpers ─────────────

  seedResource(s: NonNullable<MockOptions["seed"]>[number]): MockResource {
    const id = s.id ?? randomUUID().replace(/-/g, "");
    const now = s.created ?? new Date().toISOString();
    const fields: Record<string, MockField> = {};
    if (s.transcript !== undefined || (s.contentType && /^(audio|video)\//.test(s.contentType))) {
      const text = s.transcript ?? s.text ?? SAMPLE_CALL_TRANSCRIPT;
      const ct = s.contentType ?? "text/plain";
      if (/^(audio|video)\//.test(ct)) {
        fields.media = {
          kind: "file",
          filename: s.filename ?? "call.mp3",
          contentType: ct,
          bytes: Buffer.alloc(64 * 1024, 1),
          text,
          paragraphs: paragraphsFor(text, true),
          classifications: [],
        };
      } else {
        fields.transcript = {
          kind: "text",
          body: text,
          format: "PLAIN",
          text,
          paragraphs: paragraphsFor(text, true),
          classifications: [],
        };
      }
    } else {
      const text =
        s.text ??
        sampleTextFor(s.filename ?? s.title) ??
        `${s.title}\n\nSample document content for ${s.title}.`;
      const ct = s.contentType ?? "text/plain";
      if (s.filename && ct !== "text/plain") {
        fields.file = {
          kind: "file",
          filename: s.filename,
          contentType: ct,
          bytes: Buffer.from(text),
          text,
          paragraphs: paragraphsFor(text, false),
          classifications: [],
        };
      } else {
        fields.text = {
          kind: "text",
          body: text,
          format: "PLAIN",
          text,
          paragraphs: paragraphsFor(text, false),
          classifications: [],
        };
      }
    }
    const res: MockResource = {
      id,
      slug: s.slug ?? s.title.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
      title: s.title,
      icon:
        s.icon ??
        (fields.media ? fields.media.contentType! : fields.file ? fields.file.contentType! : "text/plain"),
      created: now,
      modified: now,
      origin: s.origin ?? { created: now, modified: now },
      extra: s.extra ?? (s.metadata ? { metadata: s.metadata } : undefined),
      usermetadata: s.usermetadata,
      status: "PROCESSED",
      processedAt: Date.now() - (this.opts.searchableLagMs ?? 0) - 1,
      fields,
      computed: s.computed ?? [],
    };
    this.resources.set(id, res);
    return res;
  }

  private textOf(r: MockResource): string {
    return Object.values(r.fields)
      .filter((f) => !f.kind || true)
      .map((f) => f.text)
      .join("\n\n");
  }

  private tick(r: MockResource): MockResource {
    if (r.status === "PENDING" && Date.now() >= r.processedAt) r.status = "PROCESSED";
    return r;
  }

  private searchable(r: MockResource): boolean {
    this.tick(r);
    return r.status === "PROCESSED" && Date.now() >= r.processedAt + (this.opts.searchableLagMs ?? 0);
  }

  private fieldKey(fid: string, f: MockField): string {
    return `${f.kind === "file" ? "f" : "t"}/${fid}`;
  }

  /** Nuclia-ish summary for catalog/find. */
  private summary(r: MockResource): ResourceSummary {
    return {
      id: r.id,
      slug: r.slug,
      title: r.title,
      icon: r.icon,
      created: r.created,
      modified: r.modified,
      metadata: { status: r.status },
      origin: r.origin,
      extra: r.extra,
      usermetadata: r.usermetadata,
      computedmetadata: r.computed.length
        ? {
            field_classifications: [
              { field: { field: Object.keys(r.fields)[0], field_type: "file" }, classifications: r.computed },
            ],
          }
        : { field_classifications: [] },
    };
  }

  /** Full resource per `show`/`extracted` selectors. */
  private full(r: MockResource, show: string[], extracted: string[]): Record<string, unknown> {
    const base = this.summary(r) as Record<string, unknown>;
    if (!show.includes("origin")) delete base.origin;
    if (!show.includes("extra")) delete base.extra;
    if (show.includes("values") || show.includes("extracted")) {
      const data: Record<string, Record<string, unknown>> = {};
      for (const [fid, f] of Object.entries(r.fields)) {
        const cat = f.kind === "file" ? "files" : "texts";
        const entry: Record<string, unknown> = {};
        if (show.includes("values")) {
          entry.value =
            f.kind === "file"
              ? { file: { filename: f.filename, content_type: f.contentType, size: f.bytes?.length ?? 0 } }
              : { body: f.body, format: f.format ?? "PLAIN" };
        }
        if (show.includes("extracted")) {
          const ex: Record<string, unknown> = {};
          if (extracted.length === 0 || extracted.includes("text")) ex.text = { text: f.text };
          if (extracted.length === 0 || extracted.includes("metadata"))
            ex.metadata = {
              metadata: { paragraphs: f.paragraphs, classifications: f.classifications, language: "en" },
            };
          entry.extracted = ex;
        }
        if (!data[cat]) data[cat] = {};
        data[cat]![fid] = entry;
      }
      data.generics = { title: { value: r.title, extracted: { text: { text: r.title } } } };
      base.data = data;
    }
    return base;
  }

  // ───────────── retrieval ─────────────

  retrieve(req: { query: string; resource_filters?: string[]; top_k?: number }): {
    resources: Record<string, Record<string, unknown>>;
    hits: Array<{ r: MockResource; fid: string; f: MockField; p: ParagraphMeta; score: number }>;
  } {
    const q = tokens(req.query);
    const pool = [...this.resources.values()].filter(
      (r) => this.searchable(r) && (!req.resource_filters?.length || req.resource_filters.includes(r.id)),
    );
    const hits: Array<{ r: MockResource; fid: string; f: MockField; p: ParagraphMeta; score: number }> = [];
    for (const r of pool) {
      for (const [fid, f] of Object.entries(r.fields)) {
        if (fid.startsWith("da-")) continue; // generated fields are not retrieval targets in the mock
        for (const p of f.paragraphs) {
          const pt = tokens(f.text.slice(p.start ?? 0, p.end ?? 0));
          const overlap = q.filter((t) => pt.includes(t)).length;
          const score = q.length ? overlap / q.length : 0;
          if (score > 0 || (req.resource_filters?.length && q.length === 0))
            hits.push({ r, fid, f, p, score: Math.max(score, 0.05) });
        }
      }
    }
    // A filtered resource always retrieves (full_resource extraction seeds queries with its own text).
    if (hits.length === 0 && req.resource_filters?.length) {
      for (const r of pool)
        for (const [fid, f] of Object.entries(r.fields))
          if (!fid.startsWith("da-"))
            for (const p of f.paragraphs.slice(0, 3)) hits.push({ r, fid, f, p, score: 0.05 });
    }
    hits.sort((a, b) => b.score - a.score);
    const top = hits.slice(0, req.top_k ?? 20);
    const resources: Record<string, Record<string, unknown>> = {};
    for (const h of top) {
      const key = this.fieldKey(h.fid, h.f);
      if (!resources[h.r.id]) {
        resources[h.r.id] = {
          id: h.r.id,
          title: h.r.title,
          slug: h.r.slug,
          icon: h.r.icon,
          origin: h.r.origin,
          fields: {},
        };
      }
      const res = resources[h.r.id]!;
      const fields = res.fields as Record<string, { paragraphs: Record<string, unknown> }>;
      if (!fields[`/${key}`]) fields[`/${key}`] = { paragraphs: {} };
      const fe = fields[`/${key}`]!;
      const pid = `${h.r.id}/${key}/${h.p.start}-${h.p.end}`;
      fe.paragraphs[pid] = {
        id: pid,
        score: Number(h.score.toFixed(3)),
        score_type: "BOTH",
        order: Object.keys(fe.paragraphs).length,
        text: h.f.text.slice(h.p.start ?? 0, h.p.end ?? 0),
        labels: h.p.classifications?.map((c) => `/l/${c.labelset}/${c.label}`) ?? [],
        position: {
          start: h.p.start,
          end: h.p.end,
          start_seconds: h.p.start_seconds,
          end_seconds: h.p.end_seconds,
        },
      };
    }
    return { resources, hits: top };
  }

  // ───────────── data augmentation ─────────────

  private applyTask(task: Record<string, unknown>): void {
    const params = (task.parameters ?? {}) as { on?: number; operations?: Array<Record<string, unknown>> };
    for (const r of this.resources.values()) {
      const text = this.textOf(r);
      for (const op of params.operations ?? []) {
        if (op.label) {
          const label = op.label as {
            ident: string;
            labels: Array<{ label: string; description?: string }>;
            multiple?: boolean;
          };
          const choose = (t: string): string[] => {
            const tt = tokens(t);
            const scored = label.labels.map((l) => ({
              l: l.label,
              s: tokens(`${l.label} ${l.description ?? ""}`).filter((x) => tt.includes(x)).length,
            }));
            scored.sort((a, b) => b.s - a.s);
            const best = scored.filter((x) => x.s > 0).map((x) => x.l);
            return label.multiple
              ? best.slice(0, params.on === 0 ? 1 : 2)
              : [best[0] ?? label.labels[0]?.label ?? ""];
          };
          if (params.on === 0) {
            for (const f of Object.values(r.fields))
              for (const p of f.paragraphs) {
                const chosen = choose(f.text.slice(p.start ?? 0, p.end ?? 0)).filter(Boolean);
                p.classifications = [
                  ...(p.classifications ?? []).filter((c) => c.labelset !== label.ident),
                  ...chosen.map((c) => ({ labelset: label.ident, label: c })),
                ];
              }
          } else {
            r.computed = [
              ...r.computed.filter((c) => c.labelset !== label.ident),
              ...choose(text)
                .filter(Boolean)
                .map((c) => ({ labelset: label.ident, label: c })),
            ];
          }
          if (!this.labelsets.has(label.ident))
            this.labelsets.set(label.ident, {
              title: label.ident,
              kind: [params.on === 0 ? "PARAGRAPHS" : "RESOURCES"],
              multiple: Boolean(label.multiple),
              labels: label.labels.map((l) => ({ title: l.label })),
            });
        }
        if (op.ask) {
          const ask = op.ask as { destination: string; question?: string; json?: boolean };
          const [fid, f] = Object.entries(r.fields).find(
            ([, x]) => !x.body?.startsWith("```json") && !x.body?.startsWith("{"),
          ) ?? [Object.keys(r.fields)[0]!, Object.values(r.fields)[0]!];
          let obj: Record<string, unknown>;
          if (/call_metrics|metrics/.test(ask.destination)) obj = callMetricsFixture(f.text);
          else if (/call_analysis|analysis/.test(ask.destination)) obj = callAnalysisFixture(f.text);
          else obj = { summary: `${f.text.split(/\s+/).slice(0, 40).join(" ")}…` };
          const body = ask.json ? JSON.stringify(obj) : `\`\`\`json\n${JSON.stringify(obj, null, 2)}\n\`\`\``;
          const did = `da-${ask.destination}-${f.kind === "file" ? "f" : "t"}-${fid}`;
          r.fields[did] = {
            kind: "text",
            body,
            format: "PLAIN",
            text: body,
            paragraphs: paragraphsFor(body, false),
            classifications: [],
          };
        }
      }
    }
  }

  // ───────────── HTTP ─────────────

  buildApp(): App {
    const env = readEnv({
      NODE_ENV: "test",
      LOG_LEVEL: "warn",
      RATE_LIMIT_RPS: "0",
      MAX_BODY_BYTES: "104857600",
      PORT: "0",
    });
    const app = new App({ env, log: this.log });
    const kb = `/api/v1/kb/:kb`;
    const record = (ctx: Ctx) => {
      this.calls.push({ method: ctx.method, path: ctx.path, body: ctx.body });
      if (ctx.params.kb !== this.kbId) throw notFound("Knowledge box");
    };
    app.use(async (ctx, next) => {
      if (ctx.path.startsWith("/api/v1/kb/")) {
        const h = ctx.header("x-nuclia-serviceaccount") ?? "";
        if (this.apiKey && h !== `Bearer ${this.apiKey}`)
          throw new HttpError(401, "Unauthorized", "Invalid service account token");
      }
      await next();
    });
    app.get("/healthz", () => ({ ok: true, mock: true, kb: this.kbId }));

    // ---- upload / resources ----
    app.post(
      `${kb}/upload`,
      async (ctx) => {
        record(ctx);
        const bytes = ctx.rawBody ?? Buffer.alloc(0);
        if (!bytes.length) throw badRequest("empty body");
        const filename = ctx.header("x-filename")
          ? Buffer.from(ctx.header("x-filename")!, "base64").toString("utf8")
          : "upload.bin";
        const ct = ctx.header("content-type") ?? "application/octet-stream";
        const text =
          ct.startsWith("text/") || looksText(bytes)
            ? bytes.toString("utf8")
            : (sampleTextFor(filename) ?? `Scanned document ${filename}\n\n(Visual extraction placeholder)`);
        const r = this.seedResource({ title: filename, filename, contentType: ct, text });
        const seededId = Object.keys(r.fields)[0]!;
        const seeded = r.fields[seededId]!;
        delete r.fields[seededId];
        r.fields.file = { ...seeded, kind: "file", filename, contentType: ct, bytes, body: undefined };
        r.icon = ct;
        r.status = (this.opts.processingMs ?? 0) > 0 ? "PENDING" : "PROCESSED";
        r.processedAt = Date.now() + (this.opts.processingMs ?? 0);
        if (ctx.query.get("extract_strategy")) {
          if (!r.extra) r.extra = {};
          r.extra.metadata = {
            ...(r.extra.metadata ?? {}),
            extract_strategy: ctx.query.get("extract_strategy"),
          };
        }
        ctx.json(201, { uuid: r.id, field_id: "file", seqid: this.resources.size });
      },
      { body: "raw", bodyLimit: 100 * 1024 * 1024 },
    );

    app.post(`${kb}/resources`, (ctx) => {
      record(ctx);
      const b = ctx.body as Record<string, unknown>;
      const texts = (b.texts ?? {}) as Record<string, { body: string; format?: string }>;
      const first = Object.entries(texts)[0];
      const r = this.seedResource({
        title: String(b.title ?? "Untitled"),
        slug: b.slug as string | undefined,
        icon: b.icon as string | undefined,
        origin: b.origin as Record<string, unknown> | undefined,
        extra: b.extra as { metadata?: Record<string, unknown> } | undefined,
        usermetadata: b.usermetadata as MockResource["usermetadata"],
        transcript: first && /transcript/.test(first[0]) ? first[1].body : undefined,
        text: first && !/transcript/.test(first[0]) ? first[1].body : undefined,
      });
      if (first) {
        const fid = first[0];
        const f = r.fields.transcript ?? r.fields.text!;
        delete r.fields.transcript;
        delete r.fields.text;
        r.fields[fid] = f;
      } else {
        r.fields = {};
      }
      if ((b.icon as string | undefined)?.match(/^(audio|video)\//)) r.status = "PENDING";
      ctx.json(201, { uuid: r.id, seqid: this.resources.size });
    });

    app.post(
      `${kb}/resource/:rid/file/:field/upload`,
      (ctx) => {
        record(ctx);
        const r = this.resources.get(ctx.params.rid!);
        if (!r) throw notFound("Resource");
        const bytes = ctx.rawBody ?? Buffer.alloc(0);
        const filename = ctx.header("x-filename")
          ? Buffer.from(ctx.header("x-filename")!, "base64").toString("utf8")
          : "file";
        const ct = ctx.header("content-type") ?? "application/octet-stream";
        const media = /^(audio|video)\//.test(ct);
        const text =
          ct.startsWith("text/") || looksText(bytes)
            ? bytes.toString("utf8")
            : media
              ? SAMPLE_CALL_TRANSCRIPT
              : (sampleTextFor(filename) ?? `Scanned document ${filename}`);
        r.fields[ctx.params.field!] = {
          kind: "file",
          filename,
          contentType: ct,
          bytes,
          text,
          paragraphs: paragraphsFor(text, media),
          classifications: [],
        };
        r.icon = ct;
        r.status = (this.opts.processingMs ?? 0) > 0 ? "PENDING" : "PROCESSED";
        r.processedAt = Date.now() + (this.opts.processingMs ?? 0);
        ctx.json(201, { uuid: r.id, field_id: ctx.params.field, seqid: 1 });
      },
      { body: "raw", bodyLimit: 100 * 1024 * 1024 },
    );

    app.get(`${kb}/resource/:rid`, (ctx) => {
      record(ctx);
      const r = this.resources.get(ctx.params.rid!);
      if (!r) throw notFound("Resource");
      this.tick(r);
      return this.full(
        r,
        ctx.query.getAll("show").flatMap((s) => s.split(",")),
        ctx.query.getAll("extracted").flatMap((s) => s.split(",")),
      );
    });

    app.delete(`${kb}/resource/:rid`, (ctx) => {
      record(ctx);
      if (!this.resources.delete(ctx.params.rid!)) throw notFound("Resource");
      ctx.noContent();
    });

    app.get(`${kb}/resource/:rid/file/:field/download/field`, (ctx) => {
      record(ctx);
      const r = this.resources.get(ctx.params.rid!);
      const f = r?.fields[ctx.params.field!];
      if (!r || !f || f.kind !== "file") throw notFound("File field");
      const bytes = f.bytes ?? Buffer.alloc(0);
      const range = ctx.header("range");
      const m = range ? /bytes=(\d*)-(\d*)/.exec(range) : null;
      if (m) {
        const start = m[1] ? Number(m[1]) : 0;
        const end = m[2] ? Math.min(Number(m[2]), bytes.length - 1) : bytes.length - 1;
        const chunk = bytes.subarray(start, end + 1);
        ctx.res.writeHead(206, {
          "Content-Type": f.contentType ?? "application/octet-stream",
          "Content-Length": chunk.length,
          "Content-Range": `bytes ${start}-${end}/${bytes.length}`,
          "Accept-Ranges": "bytes",
        });
        ctx.res.end(chunk);
        return;
      }
      ctx.res.writeHead(200, {
        "Content-Type": f.contentType ?? "application/octet-stream",
        "Content-Length": bytes.length,
        "Accept-Ranges": "bytes",
      });
      ctx.res.end(bytes);
    });

    // ---- search ----
    app.post(`${kb}/find`, (ctx) => {
      record(ctx);
      const b = ctx.body as { query?: string; resource_filters?: string[]; top_k?: number };
      const { resources } = this.retrieve({
        query: b.query ?? "",
        resource_filters: b.resource_filters,
        top_k: b.top_k,
      });
      return {
        resources,
        total: Object.keys(resources).length,
        page_number: 0,
        page_size: b.top_k ?? 20,
        next_page: false,
      };
    });

    app.post(`${kb}/catalog`, (ctx) => {
      record(ctx);
      const b = ctx.body as { page_number?: number; page_size?: number; query?: string };
      const all = [...this.resources.values()]
        .map((r) => this.tick(r))
        .filter((r) => !b.query || r.title.toLowerCase().includes(b.query.toLowerCase()))
        .sort((a, c) => c.created.localeCompare(a.created));
      const size = b.page_size ?? 20;
      const page = b.page_number ?? 0;
      const slice = all.slice(page * size, page * size + size);
      const resources: Record<string, ResourceSummary> = {};
      for (const r of slice) resources[r.id] = this.summary(r);
      return {
        resources,
        fulltext: {
          page_number: page,
          page_size: size,
          next_page: (page + 1) * size < all.length,
          total: all.length,
        },
      };
    });

    // ---- ask ----
    const ask = async (ctx: Ctx) => {
      record(ctx);
      const req = ctx.body as AskRequest;
      const rid = ctx.params.rid;
      const filters = rid ? [rid] : req.resource_filters;
      const cfg = req.search_configuration
        ? (this.searchConfigs.get(req.search_configuration)?.config as Record<string, unknown> | undefined)
        : undefined;
      if (req.search_configuration && !cfg)
        throw new HttpError(404, "Not found", `search configuration ${req.search_configuration} not found`);
      const effective: AskRequest = { ...(cfg as Partial<AskRequest>), ...req };
      if (effective.answer_json_schema && effective.citations)
        throw new HttpError(422, "Unprocessable", "citations cannot be used with answer_json_schema");
      const { resources, hits } = this.retrieve({
        query: effective.query,
        resource_filters: filters,
        top_k: effective.top_k,
      });
      ctx.res.writeHead(200, {
        "Content-Type": "application/x-ndjson; charset=utf-8",
        "Cache-Control": "no-store",
      });
      const write = (item: Record<string, unknown>) => ctx.res.write(toNdjsonLine(item));
      write({ type: "retrieval", results: { resources, relations: {} } });
      const primary = hits[0];
      const text = primary
        ? effective.rag_strategies?.some((s) => s.name === "full_resource") || cfg
          ? this.textOf(primary.r)
          : hits.map((h) => h.f.text.slice(h.p.start ?? 0, h.p.end ?? 0)).join("\n\n")
        : "";
      const hook = this.opts.answerHook?.(effective, { text, resources: hits.map((h) => h.r) });
      if (effective.answer_json_schema) {
        const obj =
          hook?.answerJson ??
          (primary
            ? synthesizeJson(effective.answer_json_schema, text, primary.r.title, effective.query)
            : {});
        write({ type: "answer", text: "" });
        write({ type: "answer_json", object: obj });
      } else {
        let answer: string;
        const sys =
          typeof effective.prompt === "object" && effective.prompt
            ? String(effective.prompt.system ?? "")
            : "";
        if (hook?.answer !== undefined) answer = hook.answer;
        else if (!primary || primary.score <= 0.05)
          answer = /HANDOFF:/.test(sys)
            ? "HANDOFF: not in the knowledge base."
            : "Not enough data to answer this.";
        else {
          const q = effective.query.toLowerCase();
          const para = primary.f.text
            .slice(primary.p.start ?? 0, primary.p.end ?? 0)
            .replace(/^(Agent|Member):\s*/, "");
          // Prefer the sentences that share the most vocabulary with the query, then keep reading order.
          const qt = tokens(effective.query);
          const ranked = para
            .split(/(?<=[.!?])\s+/)
            .map((sent, i) => ({ sent, i, score: tokens(sent).filter((t) => qt.includes(t)).length }))
            .sort((a, b) => b.score - a.score || a.i - b.i)
            .slice(0, 2)
            .sort((a, b) => a.i - b.i);
          const sentences = ranked.map((r) => r.sent).join(" ");
          answer = /summar/.test(q)
            ? `${this.textOf(primary.r).split(/\s+/).slice(0, 45).join(" ")}.`
            : sentences.length > 20
              ? sentences
              : `${primary.r.title}: ${para}`;
          if (/^HANDOFF|not in the knowledge/.test(answer)) answer = "HANDOFF: not in the knowledge base.";
        }
        const words = answer.split(" ");
        for (let i = 0; i < words.length; i += 4) {
          write({ type: "answer", text: (i ? " " : "") + words.slice(i, i + 4).join(" ") });
          await sleep(this.opts.streamDelayMs ?? 0);
        }
        if (effective.citations && primary && primary.score > 0.05) {
          const citations: Record<string, Array<[number, number]>> = {};
          for (const h of hits.slice(0, 3))
            citations[`${h.r.id}/${this.fieldKey(h.fid, h.f)}/${h.p.start}-${h.p.end}`] = [
              [0, answer.length],
            ];
          write({ type: "citations", citations });
        }
      }
      write({
        type: "metadata",
        tokens: { input: 800, output: 120 },
        timings: { generative_first_chunk: 0.4, generative_total: 1.2 },
      });
      write({ type: "status", code: "0", status: "success" });
      ctx.res.end();
    };
    app.post(`${kb}/ask`, ask);
    app.post(`${kb}/resource/:rid/ask`, ask);

    // ---- search configurations ----
    app.get(`${kb}/search_configurations`, (ctx) => {
      record(ctx);
      return Object.fromEntries(this.searchConfigs);
    });
    app.get(`${kb}/search_configurations/:name`, (ctx) => {
      record(ctx);
      const c = this.searchConfigs.get(ctx.params.name!);
      if (!c) throw notFound("Search configuration");
      return c;
    });
    app.post(`${kb}/search_configurations/:name`, (ctx) => {
      record(ctx);
      const existed = this.searchConfigs.has(ctx.params.name!);
      this.searchConfigs.set(ctx.params.name!, ctx.body as Record<string, unknown>);
      ctx.json(existed ? 200 : 201, {});
    });
    app.patch(`${kb}/search_configurations/:name`, (ctx) => {
      record(ctx);
      this.searchConfigs.set(ctx.params.name!, ctx.body as Record<string, unknown>);
      ctx.json(200, {});
    });
    app.delete(`${kb}/search_configurations/:name`, (ctx) => {
      record(ctx);
      if (!this.searchConfigs.delete(ctx.params.name!)) throw notFound("Search configuration");
      ctx.noContent();
    });

    // ---- labelsets ----
    app.get(`${kb}/labelsets`, (ctx) => {
      record(ctx);
      return { uuid: this.kbId, labelsets: Object.fromEntries(this.labelsets) };
    });
    app.post(`${kb}/labelset/:id`, (ctx) => {
      record(ctx);
      this.labelsets.set(ctx.params.id!, ctx.body as Labelset);
      ctx.json(200, {});
    });
    app.delete(`${kb}/labelset/:id`, (ctx) => {
      record(ctx);
      this.labelsets.delete(ctx.params.id!);
      ctx.noContent();
    });

    // ---- tasks ----
    app.get(`${kb}/tasks`, (ctx) => {
      record(ctx);
      return {
        tasks: [
          "labeler",
          "ask",
          "qa",
          "llm-graph",
          "synthetic-questions",
          "llm-align",
          "llama-guard",
          "prompt-guard",
          "memory",
        ],
        ...this.tasks,
      };
    });
    app.post(`${kb}/task/start`, (ctx) => {
      record(ctx);
      const b = ctx.body as { name: string; parameters: Record<string, unknown> };
      if (!b.name || !b.parameters)
        throw new HttpError(422, "Unprocessable", "name and parameters are required");
      const opType = ((b.parameters.operations as Array<Record<string, unknown>> | undefined) ?? [])
        .map((o) => Object.keys(o)[0])
        .join(",");
      if (this.tasks.running.some((t) => t.opType === opType))
        throw new HttpError(422, "Unprocessable", `Already running an operation of type ${opType}`);
      if (!b.parameters.llm) throw new HttpError(422, "Unprocessable", "llm configuration is required");
      const id = randomUUID();
      const task = {
        id,
        task: { name: b.name },
        parameters: b.parameters,
        opType,
        completed: false,
        failed: false,
        stopped: false,
      };
      this.tasks.configs.push({ ...task });
      this.applyTask(task);
      this.tasks.done.push({ ...task, completed: true });
      ctx.json(200, { name: b.name, status: "started", id });
    });
    app.delete(`${kb}/task/:id`, (ctx) => {
      record(ctx);
      for (const k of ["configs", "running", "done"] as const)
        this.tasks[k] = this.tasks[k].filter((t) => t.id !== ctx.params.id);
      ctx.json(200, {});
    });

    // ---- predict ----
    app.post(`${kb}/predict/remi`, (ctx) => {
      record(ctx);
      const b = ctx.body as { answer?: string; contexts?: string[] };
      const n = b.contexts?.length ?? 0;
      const decline = /not enough data/i.test(b.answer ?? "");
      return {
        answer_relevance: { score: decline ? 1 : 4, reason: "mock" },
        context_relevance: Array.from({ length: n }, (_, i) => (i === 0 ? 4 : 2)),
        groundedness: Array.from({ length: n }, (_, i) => (i === 0 ? 4 : 3)),
      };
    });

    // ---- configuration ----
    app.get(`${kb}/configuration`, (ctx) => {
      record(ctx);
      return {
        generative_model: this.opts.generativeModel ?? "chatgpt-azure-4o",
        semantic_model: "multilingual-2024-05-06",
        anonymization_model: "disabled",
      };
    });
    app.get(`${kb}/schema`, (ctx) => {
      record(ctx);
      return {
        properties: {
          generative_model: {
            options: [
              { value: "chatgpt-azure-4o", name: "ChatGPT 4o (Azure)" },
              { value: "chatgpt4o-mini", name: "ChatGPT 4o mini" },
              { value: "gemini-2.5-flash-lite", name: "Gemini 2.5 Flash Lite" },
              { value: "claude-3-5-sonnet", name: "Claude 3.5 Sonnet" },
            ],
          },
        },
      };
    });
    return app;
  }
}

export async function startMockArag(opts: MockOptions = {}): Promise<MockAragServer> {
  const mock = new MockArag(opts);
  const app = mock.buildApp();
  const server = await app.listen(Number(process.env.MOCK_PORT ?? 0), "127.0.0.1");
  const port = (server.address() as { port: number }).port;
  return {
    app,
    mock,
    url: `http://127.0.0.1:${port}/api/v1`,
    kbId: mock.kbId,
    apiKey: mock.apiKey,
    close: () => app.close(),
  };
}
