/**
 * Minimal, tested HTTP toolkit on `node:http` for ARAG products.
 *
 *   const app = new App({ env, log });
 *   app.use(requestId(), securityHeaders(), cors(env.allowedOrigins), rateLimit(env));
 *   app.get("/api/v1/things/:id", async (ctx) => ({ id: ctx.params.id }), { auth: "api", validate: { params: {...} } });
 *   app.docs("/api/v1", openapiDoc);   // openapi.json + Redoc + Swagger UI
 *   app.static("/", "./public");
 *   await app.listen();
 *
 * Handlers may return a JSON-serialisable value (sent as 200) or write the response themselves.
 * Errors are rendered as RFC 9457 problem+json. Everything is dependency-free.
 */
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { createReadStream, realpathSync, statSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { extname, normalize, resolve, sep } from "node:path";
import type { PlatformEnv } from "../config/env.ts";
import { log as defaultLog, type Logger } from "../log/logger.ts";
import { validate as validateSchema } from "../validation/jsonschema.ts";
import { parseMultipart } from "./multipart.ts";
import {
  forbidden,
  HttpError,
  internalError,
  notFound,
  payloadTooLarge,
  tooManyRequests,
  unauthorized,
  validationError,
} from "./problem.ts";

export type AuthMode = "none" | "api" | "admin";

export interface RouteOptions {
  /** none (default): public; api: API key / session / admin token when API_KEYS set; admin: admin token required. */
  auth?: AuthMode;
  validate?: { body?: unknown; query?: unknown; params?: unknown; headers?: unknown };
  /** Max request body bytes for this route (default env.maxBodyBytes). */
  bodyLimit?: number;
  /** Parse the body as: json (default when content-type is json), multipart, raw, none. */
  body?: "auto" | "json" | "multipart" | "raw" | "none";
  /** Skip the rate limiter for this route. */
  noRateLimit?: boolean;
  /** Per-route limit (separate bucket per client and route), e.g. { rps: 1, burst: 5 } for expensive endpoints. */
  rateLimit?: { rps: number; burst: number };
  /** OpenAPI operationId, used by contract tests to map routes to spec paths. */
  operationId?: string;
}

export interface UploadedFile {
  field: string;
  filename: string;
  contentType: string;
  data: Buffer;
}

export interface AuthInfo {
  admin: boolean;
  apiKey: string | null;
  session: boolean;
  /** How the caller authenticated: admin-token | api-key | session | anonymous */
  via: "admin-token" | "api-key" | "session" | "anonymous";
}

export interface SseSender {
  send(event: string, data: unknown, id?: string): boolean;
  comment(text: string): void;
  close(): void;
  readonly closed: boolean;
  onClose(fn: () => void): void;
}

export class Ctx {
  readonly req: IncomingMessage;
  readonly res: ServerResponse;
  readonly url: URL;
  readonly method: string;
  readonly path: string;
  readonly query: URLSearchParams;
  readonly requestId: string;
  readonly env: PlatformEnv;
  readonly startedAt: number;
  readonly state: Record<string, unknown> = {};
  log: Logger;
  params: Record<string, string> = {};
  auth: AuthInfo = { admin: false, apiKey: null, session: false, via: "anonymous" };
  /** Parsed JSON body (after validation/coercion) or multipart fields. */
  body: unknown = undefined;
  rawBody: Buffer | null = null;
  files: UploadedFile[] = [];
  /** Coerced/validated query object (when a query schema is declared). */
  queryObj: Record<string, unknown> = {};
  route: { method: string; pattern: string; opts: RouteOptions } | null = null;
  private _sent = false;

  constructor(req: IncomingMessage, res: ServerResponse, env: PlatformEnv, log: Logger) {
    this.req = req;
    this.res = res;
    this.env = env;
    this.log = log;
    this.method = (req.method ?? "GET").toUpperCase();
    this.url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    this.path = this.url.pathname;
    this.query = this.url.searchParams;
    this.requestId =
      (typeof req.headers["x-request-id"] === "string" && req.headers["x-request-id"].slice(0, 64)) ||
      randomUUID();
    this.startedAt = performance.now();
  }

  get sent(): boolean {
    return this._sent || this.res.headersSent;
  }

  header(name: string): string | undefined {
    const v = this.req.headers[name.toLowerCase()];
    return Array.isArray(v) ? v[0] : v;
  }

  /**
   * Client IP. Proxy headers are trusted only per TRUST_PROXY (env): "fly" (default) trusts
   * `Fly-Client-IP` (set by Fly's edge, not spoofable behind it), "xff" trusts the first
   * `X-Forwarded-For` entry, "none" uses the socket address. Never trust XFF blindly: a client
   * could rotate it per request and defeat per-IP rate limiting.
   */
  get ip(): string {
    const mode = this.env.trustProxy;
    if (mode === "fly") {
      const fly = this.header("fly-client-ip");
      if (fly) return fly;
    } else if (mode === "xff") {
      const xff = this.header("x-forwarded-for");
      if (xff) return xff.split(",")[0]!.trim();
    }
    return this.req.socket.remoteAddress ?? "unknown";
  }

  cookies(): Record<string, string> {
    const out: Record<string, string> = {};
    for (const part of (this.header("cookie") ?? "").split(";")) {
      const i = part.indexOf("=");
      if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
    }
    return out;
  }

  setCookie(
    name: string,
    value: string,
    opts: {
      maxAge?: number;
      path?: string;
      httpOnly?: boolean;
      secure?: boolean;
      sameSite?: "Lax" | "Strict" | "None";
    } = {},
  ): void {
    const parts = [
      `${name}=${encodeURIComponent(value)}`,
      `Path=${opts.path ?? "/"}`,
      `SameSite=${opts.sameSite ?? "Lax"}`,
    ];
    if (opts.httpOnly !== false) parts.push("HttpOnly");
    if (opts.secure ?? this.env.nodeEnv === "production") parts.push("Secure");
    if (opts.maxAge !== undefined) parts.push(`Max-Age=${opts.maxAge}`);
    const prev = this.res.getHeader("Set-Cookie");
    const list = Array.isArray(prev) ? prev : prev ? [String(prev)] : [];
    this.res.setHeader("Set-Cookie", [...list, parts.join("; ")]);
  }

  json(status: number, body: unknown, headers: Record<string, string> = {}): void {
    const data = Buffer.from(JSON.stringify(body));
    this.res.writeHead(status, {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Length": data.length,
      ...headers,
    });
    this.res.end(data);
    this._sent = true;
  }

  text(
    status: number,
    body: string,
    type = "text/plain; charset=utf-8",
    headers: Record<string, string> = {},
  ): void {
    const data = Buffer.from(body);
    this.res.writeHead(status, { "Content-Type": type, "Content-Length": data.length, ...headers });
    this.res.end(data);
    this._sent = true;
  }

  html(body: string, status = 200): void {
    this.text(status, body, "text/html; charset=utf-8");
  }

  redirect(location: string, status = 302): void {
    this.res.writeHead(status, { Location: location });
    this.res.end();
    this._sent = true;
  }

  noContent(): void {
    this.res.writeHead(204);
    this.res.end();
    this._sent = true;
  }

  problem(err: HttpError): void {
    this.json(err.status, err.toProblem(this.path, this.requestId), {
      "Content-Type": "application/problem+json; charset=utf-8",
      ...err.headers,
    });
  }

  /** Pipe a web ReadableStream (e.g. an upstream fetch body) to the client. */
  async stream(
    status: number,
    headers: Record<string, string>,
    body: ReadableStream<Uint8Array> | null,
  ): Promise<void> {
    this.res.writeHead(status, headers);
    this._sent = true;
    if (!body) {
      this.res.end();
      return;
    }
    const reader = body.getReader();
    const onClose = () => reader.cancel().catch(() => undefined);
    this.req.on("close", onClose);
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!this.res.write(value)) await new Promise<void>((r) => this.res.once("drain", () => r()));
      }
    } finally {
      this.req.off("close", onClose);
      this.res.end();
    }
  }

  /** Open a Server-Sent Events channel. */
  sse(): SseSender {
    this.res.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    this.res.write(": connected\n\n");
    this._sent = true;
    let closed = false;
    const closers: Array<() => void> = [];
    const markClosed = () => {
      if (closed) return;
      closed = true;
      for (const fn of closers) fn();
    };
    this.req.on("close", markClosed);
    const keepalive = setInterval(() => {
      if (!closed) this.res.write(": ping\n\n");
    }, 15_000);
    closers.push(() => clearInterval(keepalive));
    const res = this.res;
    return {
      get closed() {
        return closed;
      },
      send(event, data, id) {
        if (closed) return false;
        const payload = typeof data === "string" ? data : JSON.stringify(data);
        res.write(
          `${id ? `id: ${id}\n` : ""}event: ${event}\ndata: ${payload.replace(/\n/g, "\ndata: ")}\n\n`,
        );
        return true;
      },
      comment(text) {
        if (!closed) res.write(`: ${text}\n\n`);
      },
      close() {
        if (closed) return;
        markClosed();
        res.end();
      },
      onClose(fn) {
        closers.push(fn);
      },
    };
  }
}

export type Handler = (ctx: Ctx) => unknown | Promise<unknown>;
export type Middleware = (ctx: Ctx, next: () => Promise<void>) => Promise<void> | void;

interface Route {
  method: string;
  pattern: string;
  regex: RegExp;
  keys: string[];
  handler: Handler;
  opts: RouteOptions;
}

function compile(pattern: string): { regex: RegExp; keys: string[] } {
  const keys: string[] = [];
  const src = pattern
    .replace(/\/+$/, "")
    .split("/")
    .map((seg) => {
      if (seg.startsWith(":")) {
        keys.push(seg.slice(1).replace(/\*$/, ""));
        return seg.endsWith("*") ? "(.+)" : "([^/]+)";
      }
      if (seg === "*") {
        keys.push("wildcard");
        return "(.*)";
      }
      return seg.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    })
    .join("/");
  return { regex: new RegExp(`^${src || "/"}/?$`), keys };
}

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".pdf": "application/pdf",
  ".mp3": "audio/mpeg",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".woff2": "font/woff2",
  ".yaml": "application/yaml",
  ".yml": "application/yaml",
};

export function contentTypeFor(file: string): string {
  return CONTENT_TYPES[extname(file).toLowerCase()] ?? "application/octet-stream";
}

export interface AppOptions {
  env: PlatformEnv;
  log?: Logger;
  /** Secret for signing session cookies; defaults to ADMIN_TOKEN or a random per-boot secret. */
  sessionSecret?: string;
}

export class App {
  readonly env: PlatformEnv;
  readonly log: Logger;
  private readonly middlewares: Middleware[] = [];
  private readonly routes: Route[] = [];
  private readonly statics: Array<{ prefix: string; dir: string; index: string; cache: string }> = [];
  private readonly sessionSecret: string;
  private readonly buckets = new Map<string, { tokens: number; ts: number }>();
  server: Server | null = null;
  openapiDoc: Record<string, unknown> | null = null;

  constructor(opts: AppOptions) {
    this.env = opts.env;
    this.log = opts.log ?? defaultLog;
    this.sessionSecret = opts.sessionSecret || opts.env.adminToken || randomUUID();
  }

  use(...mws: Middleware[]): this {
    this.middlewares.push(...mws);
    return this;
  }

  route(method: string, pattern: string, handler: Handler, opts: RouteOptions = {}): this {
    const { regex, keys } = compile(pattern);
    this.routes.push({ method: method.toUpperCase(), pattern, regex, keys, handler, opts });
    return this;
  }
  get(p: string, h: Handler, o?: RouteOptions): this {
    return this.route("GET", p, h, o);
  }
  post(p: string, h: Handler, o?: RouteOptions): this {
    return this.route("POST", p, h, o);
  }
  put(p: string, h: Handler, o?: RouteOptions): this {
    return this.route("PUT", p, h, o);
  }
  patch(p: string, h: Handler, o?: RouteOptions): this {
    return this.route("PATCH", p, h, o);
  }
  delete(p: string, h: Handler, o?: RouteOptions): this {
    return this.route("DELETE", p, h, o);
  }

  /** Registered routes (for contract tests and admin route listing). */
  listRoutes(): Array<{ method: string; pattern: string; auth: AuthMode; operationId?: string }> {
    return this.routes.map((r) => ({
      method: r.method,
      pattern: r.pattern,
      auth: r.opts.auth ?? "none",
      operationId: r.opts.operationId,
    }));
  }

  /** Serve static files under `prefix` from `dir` (path-traversal safe). */
  static(prefix: string, dir: string, opts: { index?: string; cache?: string } = {}): this {
    this.statics.push({
      prefix: prefix.replace(/\/+$/, ""),
      dir: resolve(dir),
      index: opts.index ?? "index.html",
      cache: opts.cache ?? "no-cache",
    });
    return this;
  }

  /** Register the OpenAPI document and serve it with Redoc + Swagger UI under `base` (e.g. /api/v1). */
  docs(base: string, doc: Record<string, unknown>, opts: { title?: string } = {}): this {
    this.openapiDoc = doc;
    const b = base.replace(/\/+$/, "");
    const title = opts.title ?? String((doc.info as Record<string, unknown> | undefined)?.title ?? "API");
    this.get(
      `${b}/openapi.json`,
      (ctx) => ctx.json(200, doc, { "Cache-Control": "no-cache", "Access-Control-Allow-Origin": "*" }),
      { noRateLimit: true, operationId: "getOpenApi" },
    );
    this.get(`${b}/docs`, (ctx) => ctx.html(redocHtml(title, `${b}/openapi.json`)), {
      noRateLimit: true,
      operationId: "getDocs",
    });
    this.get(`${b}/swagger`, (ctx) => ctx.html(swaggerHtml(title, `${b}/openapi.json`)), {
      noRateLimit: true,
      operationId: "getSwagger",
    });
    return this;
  }

  // ───────────────────────────── sessions ─────────────────────────────

  /** Issue a signed session token (used to let same-origin demo UIs call API-key-protected routes). */
  issueSession(ttlSec = 12 * 3600, subject = "demo"): string {
    const exp = Math.floor(Date.now() / 1000) + ttlSec;
    const payload = Buffer.from(JSON.stringify({ sub: subject, exp })).toString("base64url");
    const sig = createHmac("sha256", this.sessionSecret).update(payload).digest("base64url");
    return `${payload}.${sig}`;
  }

  verifySession(token: string | undefined): boolean {
    if (!token) return false;
    const [payload, sig] = token.split(".");
    if (!payload || !sig) return false;
    const expected = createHmac("sha256", this.sessionSecret).update(payload).digest("base64url");
    if (sig.length !== expected.length || !timingSafeEqual(Buffer.from(sig), Buffer.from(expected)))
      return false;
    try {
      const { exp } = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { exp: number };
      return typeof exp === "number" && exp > Math.floor(Date.now() / 1000);
    } catch {
      return false;
    }
  }

  // ───────────────────────────── auth ─────────────────────────────

  private constantEq(a: string, b: string): boolean {
    return constantTimeEqual(a, b);
  }

  authenticate(ctx: Ctx): AuthInfo {
    const authz = ctx.header("authorization") ?? "";
    const bearer = authz.toLowerCase().startsWith("bearer ") ? authz.slice(7).trim() : "";
    const apiKeyHeader = ctx.header("x-api-key") ?? "";
    const cookies = ctx.cookies();
    const adminToken = this.env.adminToken;
    if (
      adminToken &&
      ((bearer && this.constantEq(bearer, adminToken)) ||
        (cookies.arag_admin && this.constantEq(cookies.arag_admin, adminToken)))
    ) {
      return { admin: true, apiKey: null, session: true, via: "admin-token" };
    }
    for (const key of this.env.apiKeys) {
      if ((bearer && this.constantEq(bearer, key)) || (apiKeyHeader && this.constantEq(apiKeyHeader, key))) {
        return { admin: false, apiKey: key, session: false, via: "api-key" };
      }
    }
    if (this.verifySession(cookies.arag_session))
      return { admin: false, apiKey: null, session: true, via: "session" };
    return { admin: false, apiKey: null, session: false, via: "anonymous" };
  }

  private enforceAuth(ctx: Ctx, mode: AuthMode): void {
    if (mode === "none") return;
    if (mode === "admin") {
      if (!this.env.adminToken)
        throw forbidden("Admin access is disabled: set ADMIN_TOKEN to enable the admin panel.");
      if (!ctx.auth.admin) throw unauthorized("Admin token required");
      return;
    }
    // api
    if (this.env.apiKeys.length === 0) return; // open API
    if (ctx.auth.admin || ctx.auth.apiKey || ctx.auth.session) return;
    throw unauthorized("API key required (X-API-Key or Authorization: Bearer)");
  }

  // ───────────────────────────── rate limit ─────────────────────────────

  private rateLimited(ctx: Ctx, route?: { rps: number; burst: number; key: string }): number | null {
    const rps = route ? route.rps : this.env.rateLimitRps;
    if (rps <= 0) return null;
    const burst = Math.max(1, route ? route.burst : this.env.rateLimitBurst);
    const who = ctx.auth.apiKey ? `k:${ctx.auth.apiKey}` : `ip:${ctx.ip}`;
    const key = route ? `${route.key}|${who}` : who;
    const now = Date.now();
    let b = this.buckets.get(key);
    if (!b) {
      b = { tokens: burst, ts: now };
      this.buckets.set(key, b);
      if (this.buckets.size > 10_000) this.buckets.delete(this.buckets.keys().next().value as string);
    }
    b.tokens = Math.min(burst, b.tokens + ((now - b.ts) / 1000) * rps);
    b.ts = now;
    if (b.tokens < 1) return Math.ceil((1 - b.tokens) / rps);
    b.tokens -= 1;
    return null;
  }

  // ───────────────────────────── body ─────────────────────────────

  private async readBody(ctx: Ctx, limit: number): Promise<Buffer> {
    const declared = Number(ctx.header("content-length") ?? 0);
    if (declared > limit) throw payloadTooLarge(limit);
    const chunks: Buffer[] = [];
    let total = 0;
    for await (const chunk of ctx.req) {
      total += (chunk as Buffer).length;
      if (total > limit) throw payloadTooLarge(limit);
      chunks.push(chunk as Buffer);
    }
    return Buffer.concat(chunks);
  }

  private async parseBody(ctx: Ctx, opts: RouteOptions): Promise<void> {
    const mode = opts.body ?? "auto";
    if (mode === "none" || ctx.method === "GET" || ctx.method === "HEAD") return;
    const rawCt = ctx.header("content-type") ?? "";
    const ct = rawCt.toLowerCase(); // for type checks only — the multipart boundary is case-sensitive
    const limit = opts.bodyLimit ?? this.env.maxBodyBytes;
    if (
      mode === "raw" ||
      (mode === "auto" &&
        !ct.includes("json") &&
        !ct.startsWith("multipart/form-data") &&
        !ct.startsWith("application/x-www-form-urlencoded"))
    ) {
      ctx.rawBody = await this.readBody(ctx, limit);
      return;
    }
    const raw = await this.readBody(ctx, limit);
    ctx.rawBody = raw;
    if (mode === "multipart" || ct.startsWith("multipart/form-data")) {
      const parsed = parseMultipart(raw, rawCt);
      ctx.files = parsed.files;
      ctx.body = parsed.fields;
      return;
    }
    if (ct.startsWith("application/x-www-form-urlencoded")) {
      ctx.body = Object.fromEntries(new URLSearchParams(raw.toString("utf8")));
      return;
    }
    if (raw.length === 0) {
      ctx.body = {};
      return;
    }
    try {
      ctx.body = JSON.parse(raw.toString("utf8"));
    } catch {
      throw validationError([{ path: "", message: "body is not valid JSON" }], "body");
    }
  }

  private applyValidation(ctx: Ctx, opts: RouteOptions): void {
    const v = opts.validate;
    if (!v) return;
    const root = this.openapiDoc ?? undefined;
    if (v.params) {
      const r = validateSchema(ctx.params, v.params as Record<string, unknown>, { root, coerce: true });
      if (r.errors.length) throw validationError(r.errors, "path");
      ctx.params = r.value as Record<string, string>;
    }
    if (v.query) {
      const q: Record<string, unknown> = {};
      const props = ((v.query as Record<string, unknown>).properties ?? {}) as Record<
        string,
        Record<string, unknown>
      >;
      for (const [k, vals] of groupQuery(ctx.query))
        q[k] = props[k]?.type === "array" ? vals : vals[vals.length - 1];
      const r = validateSchema(q, v.query as Record<string, unknown>, { root, coerce: true });
      if (r.errors.length) throw validationError(r.errors, "query");
      ctx.queryObj = r.value as Record<string, unknown>;
    }
    if (v.body) {
      const r = validateSchema(ctx.body, v.body as Record<string, unknown>, { root });
      if (r.errors.length) throw validationError(r.errors, "body");
      ctx.body = r.value;
    }
    if (v.headers) {
      const h: Record<string, unknown> = {};
      for (const [k, val] of Object.entries(ctx.req.headers)) h[k] = Array.isArray(val) ? val[0] : val;
      const r = validateSchema(h, v.headers as Record<string, unknown>, { root, coerce: true });
      if (r.errors.length) throw validationError(r.errors, "headers");
    }
  }

  // ───────────────────────────── dispatch ─────────────────────────────

  private match(ctx: Ctx): { route: Route; params: Record<string, string> } | null | "method" {
    let pathMatched = false;
    for (const r of this.routes) {
      const m = r.regex.exec(ctx.path);
      if (!m) continue;
      pathMatched = true;
      if (r.method !== ctx.method && !(r.method === "GET" && ctx.method === "HEAD")) continue;
      const params: Record<string, string> = {};
      r.keys.forEach((k, i) => {
        params[k] = decodeURIComponent(m[i + 1] ?? "");
      });
      return { route: r, params };
    }
    return pathMatched ? "method" : null;
  }

  private async serveStatic(ctx: Ctx): Promise<boolean> {
    if (ctx.method !== "GET" && ctx.method !== "HEAD") return false;
    for (const s of this.statics) {
      if (ctx.path !== s.prefix && !ctx.path.startsWith(`${s.prefix}/`)) continue;
      let rel = decodeURIComponent(ctx.path.slice(s.prefix.length)) || "/";
      if (rel.endsWith("/")) rel += s.index;
      const candidate = normalize(resolve(s.dir, `.${rel}`));
      if (candidate !== s.dir && !candidate.startsWith(s.dir + sep)) throw forbidden("Path traversal");
      let file: string;
      let st: ReturnType<typeof statSync>;
      try {
        file = realpathSync(candidate);
        st = statSync(file);
      } catch {
        continue;
      }
      const root = realpathSync(s.dir);
      if (file !== root && !file.startsWith(root + sep)) throw forbidden("Path traversal");
      if (st.isDirectory()) {
        ctx.redirect(`${ctx.path}/`, 301);
        return true;
      }
      ctx.res.writeHead(200, {
        "Content-Type": contentTypeFor(file),
        "Content-Length": st.size,
        "Cache-Control": s.cache,
      });
      if (ctx.method === "HEAD") {
        ctx.res.end();
        return true;
      }
      await new Promise<void>((resolveP, reject) => {
        createReadStream(file)
          .on("error", reject)
          .on("end", () => resolveP())
          .pipe(ctx.res);
      });
      return true;
    }
    return false;
  }

  /** Handle one request end-to-end (used by listen() and by in-process tests). */
  async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const ctx = new Ctx(req, res, this.env, this.log);
    ctx.log = this.log.child({ requestId: ctx.requestId });
    res.setHeader("X-Request-Id", ctx.requestId);
    const run = async (): Promise<void> => {
      ctx.auth = this.authenticate(ctx);
      const matched = this.match(ctx);
      if (matched === null) {
        if (await this.serveStatic(ctx)) return;
        throw notFound(`Route ${ctx.method} ${ctx.path}`);
      }
      if (matched === "method")
        throw new HttpError(405, "Method not allowed", `${ctx.method} is not allowed for ${ctx.path}`);
      const { route, params } = matched;
      ctx.route = { method: route.method, pattern: route.pattern, opts: route.opts };
      ctx.params = params;
      this.enforceAuth(ctx, route.opts.auth ?? "none");
      if (!route.opts.noRateLimit && !ctx.auth.admin) {
        const retry = this.rateLimited(ctx);
        if (retry !== null) throw tooManyRequests(retry);
        if (route.opts.rateLimit) {
          const r2 = this.rateLimited(ctx, {
            ...route.opts.rateLimit,
            key: `${route.method} ${route.pattern}`,
          });
          if (r2 !== null) throw tooManyRequests(r2);
        }
      }
      await this.parseBody(ctx, route.opts);
      this.applyValidation(ctx, route.opts);
      const out = await route.handler(ctx);
      if (!ctx.sent) {
        if (out === undefined || out === null) ctx.noContent();
        else ctx.json(200, out);
      }
    };
    const chain = [...this.middlewares];
    const dispatch = async (i: number): Promise<void> => {
      const mw = chain[i];
      if (!mw) return run();
      let called = false;
      await mw(ctx, () => {
        called = true;
        return dispatch(i + 1);
      });
      if (!called && !ctx.sent) await dispatch(i + 1);
    };
    try {
      await dispatch(0);
    } catch (err) {
      this.renderError(ctx, err);
    } finally {
      const ms = Math.round(performance.now() - ctx.startedAt);
      const lvl = res.statusCode >= 500 ? "error" : res.statusCode >= 400 ? "warn" : "info";
      if (!ctx.path.startsWith("/health"))
        ctx.log[lvl]("http", {
          method: ctx.method,
          path: ctx.path,
          status: res.statusCode,
          ms,
          auth: ctx.auth.via,
        });
    }
  }

  renderError(ctx: Ctx, err: unknown): void {
    const httpErr = err instanceof HttpError ? err : this.mapError(err);
    if (httpErr.status >= 500)
      ctx.log.error("http.error", {
        message: (err as Error).message,
        stack: (err as Error).stack?.split("\n").slice(0, 4).join(" | "),
      });
    if (ctx.sent) {
      ctx.res.end();
      return;
    }
    ctx.problem(httpErr);
  }

  /** Map non-HttpError exceptions (e.g. AragError) to problems. Products may override via `errorMapper`. */
  errorMapper: (err: unknown) => HttpError | null = () => null;

  private mapError(err: unknown): HttpError {
    const mapped = this.errorMapper(err);
    if (mapped) return mapped;
    const e = err as { name?: string; kind?: string; status?: number; message?: string };
    if (e?.name === "AragError") {
      if (e.kind === "timeout")
        return new HttpError(504, "Upstream timeout", "ARAG did not respond in time", {
          type: "https://arag.dev/problems/upstream-timeout",
        });
      if (e.kind === "http" && e.status === 401)
        return new HttpError(
          502,
          "Upstream error",
          "ARAG rejected the service-account token (401). Check ARAG_API_KEY.",
          { type: "https://arag.dev/problems/upstream" },
        );
      if (e.kind === "http" && e.status === 404) return notFound("Upstream resource");
      if (e.kind === "http" && e.status === 422)
        return new HttpError(
          502,
          "Upstream error",
          `ARAG rejected the request (422): ${(e as { detail?: string }).detail ?? ""}`.trim(),
          { type: "https://arag.dev/problems/upstream" },
        );
      return new HttpError(502, "Upstream error", e.message ?? "ARAG request failed", {
        type: "https://arag.dev/problems/upstream",
      });
    }
    return internalError(this.env.nodeEnv === "production" ? "Internal server error" : e?.message);
  }

  listen(port = this.env.port, host = this.env.host): Promise<Server> {
    const server = createServer((req, res) => {
      this.handle(req, res).catch((err) => {
        this.log.error("http.unhandled", { message: (err as Error).message });
        if (!res.headersSent) res.writeHead(500).end();
      });
    });
    server.requestTimeout = 15 * 60_000;
    server.headersTimeout = 65_000;
    this.server = server;
    return new Promise((resolveP, reject) => {
      server.once("error", reject);
      server.listen(port, host, () => {
        this.log.info("http.listening", {
          port: (server.address() as { port: number }).port,
          host,
          env: this.env.nodeEnv,
        });
        resolveP(server);
      });
    });
  }

  /** Stop listening and drop open connections. Safe to call more than once. */
  close(): Promise<void> {
    return new Promise((resolveP) => {
      const server = this.server;
      if (!server || !server.listening) return resolveP();
      server.close(() => resolveP());
      server.closeAllConnections?.();
    });
  }
}

/** Constant-time string comparison for tokens and keys. */
export function constantTimeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

function groupQuery(q: URLSearchParams): Map<string, string[]> {
  const m = new Map<string, string[]>();
  for (const [k, v] of q) {
    const key = k.endsWith("[]") ? k.slice(0, -2) : k;
    const arr = m.get(key) ?? [];
    arr.push(v);
    m.set(key, arr);
  }
  return m;
}

// ───────────────────────────── built-in middleware ─────────────────────────────

/**
 * Baseline security headers. The default CSP allows self plus the jsDelivr/Google Fonts CDNs used by the
 * docs pages and UI kit; products extend `connectSrc`/`scriptSrc` etc. for their own integrations
 * (e.g. VoiceBridge adds ElevenLabs/LiveKit) instead of widening every product's policy.
 */
export function securityHeaders(
  opts: {
    csp?: string;
    connectSrc?: string[];
    scriptSrc?: string[];
    styleSrc?: string[];
    mediaSrc?: string[];
    frameSrc?: string[];
    workerSrc?: string[];
  } = {},
): Middleware {
  const csp =
    opts.csp ??
    [
      "default-src 'self'",
      `script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net ${(opts.scriptSrc ?? []).join(" ")}`.trim(),
      `style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://fonts.googleapis.com ${(opts.styleSrc ?? []).join(" ")}`.trim(),
      "font-src 'self' https://fonts.gstatic.com data:",
      "img-src 'self' data: blob: https:",
      `media-src 'self' blob: ${(opts.mediaSrc ?? []).join(" ")}`.trim(),
      `connect-src 'self' https://cdn.jsdelivr.net ${(opts.connectSrc ?? []).join(" ")}`.trim(),
      `worker-src 'self' blob: ${(opts.workerSrc ?? []).join(" ")}`.trim(),
      `frame-src 'self' ${(opts.frameSrc ?? []).join(" ")}`.trim(),
      "frame-ancestors 'self'",
      "base-uri 'self'",
      "object-src 'none'",
    ].join("; ");
  return async (ctx, next) => {
    ctx.res.setHeader("X-Content-Type-Options", "nosniff");
    ctx.res.setHeader("X-Frame-Options", "SAMEORIGIN");
    ctx.res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    ctx.res.setHeader("Permissions-Policy", "camera=(), geolocation=(), microphone=(self)");
    if (ctx.env.nodeEnv === "production")
      ctx.res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
    ctx.res.setHeader("Content-Security-Policy", csp);
    await next();
  };
}

/** CORS for the configured origins ("*" allowed). Preflight is answered here. */
export function cors(allowedOrigins?: string[]): Middleware {
  return async (ctx, next) => {
    const origins = allowedOrigins ?? ctx.env.allowedOrigins;
    const origin = ctx.header("origin");
    const allow = origins.includes("*") ? "*" : origin && origins.includes(origin) ? origin : null;
    if (allow) {
      ctx.res.setHeader("Access-Control-Allow-Origin", allow);
      ctx.res.setHeader("Vary", "Origin");
      ctx.res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
      ctx.res.setHeader(
        "Access-Control-Allow-Headers",
        "Content-Type, Authorization, X-API-Key, X-Filename, X-Request-Id",
      );
      ctx.res.setHeader("Access-Control-Expose-Headers", "X-Request-Id, Content-Disposition");
      ctx.res.setHeader("Access-Control-Max-Age", "600");
    }
    if (ctx.method === "OPTIONS") {
      ctx.noContent();
      return;
    }
    await next();
  };
}

/** Basic liveness/readiness endpoints. */
export function healthRoutes(
  app: App,
  extra: () => Promise<Record<string, unknown>> | Record<string, unknown> = () => ({}),
): void {
  app.get("/healthz", () => ({ ok: true }), { noRateLimit: true, operationId: "healthz" });
  app.get("/readyz", async () => ({ ok: true, ...(await extra()) }), {
    noRateLimit: true,
    operationId: "readyz",
  });
}

// ───────────────────────────── docs pages ─────────────────────────────

function esc(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );
}

export function redocHtml(title: string, specUrl: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)} · API reference</title><meta name="viewport" content="width=device-width, initial-scale=1"><style>body{margin:0}</style></head><body><redoc spec-url="${esc(specUrl)}" hide-download-button></redoc><script src="https://cdn.jsdelivr.net/npm/redoc@2.1.5/bundles/redoc.standalone.js"></script></body></html>`;
}

export function swaggerHtml(title: string, specUrl: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)} · Swagger UI</title><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5.17.14/swagger-ui.css"></head><body><div id="swagger-ui"></div><script src="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5.17.14/swagger-ui-bundle.js"></script><script>window.ui=SwaggerUIBundle({url:${JSON.stringify(specUrl)},dom_id:"#swagger-ui",deepLinking:true,tryItOutEnabled:true});</script></body></html>`;
}
