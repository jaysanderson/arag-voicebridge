/**
 * Test helpers shared by the platform and every product:
 *   - startTestServer(app): listen on a random port, return a `request` helper.
 *   - contract checks: every route is in the OpenAPI doc; responses validate against declared schemas.
 *   - spec linting: operationIds, responses, resolvable $refs.
 */
import type { App } from "../http/app.ts";
import { schemaAt } from "../openapi/builder.ts";
import { type SchemaError, validate } from "../validation/jsonschema.ts";

export interface TestResponse {
  status: number;
  headers: Headers;
  text: string;
  json: unknown;
  raw: Response;
}

export interface TestClient {
  baseUrl: string;
  request(
    method: string,
    path: string,
    opts?: { json?: unknown; body?: BodyInit; headers?: Record<string, string> },
  ): Promise<TestResponse>;
  get(path: string, headers?: Record<string, string>): Promise<TestResponse>;
  post(path: string, json?: unknown, headers?: Record<string, string>): Promise<TestResponse>;
  close(): Promise<void>;
}

export async function startTestServer(app: App): Promise<TestClient> {
  const server = await app.listen(0, "127.0.0.1");
  const port = (server.address() as { port: number }).port;
  const baseUrl = `http://127.0.0.1:${port}`;
  const request: TestClient["request"] = async (method, path, opts = {}) => {
    const headers: Record<string, string> = { ...(opts.headers ?? {}) };
    let body: BodyInit | undefined = opts.body;
    if (opts.json !== undefined) {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify(opts.json);
    }
    const raw = await fetch(`${baseUrl}${path}`, { method, headers, body, redirect: "manual" });
    const text = await raw.text();
    let json: unknown;
    try {
      json = text ? JSON.parse(text) : undefined;
    } catch {
      json = undefined;
    }
    return { status: raw.status, headers: raw.headers, text, json, raw };
  };
  return {
    baseUrl,
    request,
    get: (p, h) => request("GET", p, { headers: h }),
    post: (p, j, h) => request("POST", p, { json: j, headers: h }),
    close: () => app.close(),
  };
}

/** Convert an Express-style pattern (/a/:id) to an OpenAPI path (/a/{id}). */
export function toOpenApiPath(pattern: string): string {
  return pattern.replace(/:([A-Za-z0-9_]+)\*?/g, "{$1}");
}

const INTERNAL = new Set(["getOpenApi", "getDocs", "getSwagger", "healthz", "readyz"]);

/** Every registered API route (pattern under `prefix`) must appear in the spec with a matching method. */
export function missingFromSpec(app: App, doc: Record<string, unknown>, prefix = "/api/v1"): string[] {
  const paths = (doc.paths ?? {}) as Record<string, Record<string, unknown>>;
  const missing: string[] = [];
  for (const r of app.listRoutes()) {
    if (!r.pattern.startsWith(prefix) || INTERNAL.has(r.operationId ?? "")) continue;
    const p = toOpenApiPath(r.pattern);
    if (!paths[p] || !paths[p]![r.method.toLowerCase()]) missing.push(`${r.method} ${r.pattern}`);
  }
  return missing;
}

/** Lint: operationId, ≥1 response, tags, and resolvable $refs across the document. */
export function lintSpec(doc: Record<string, unknown>): string[] {
  const problems: string[] = [];
  const paths = (doc.paths ?? {}) as Record<string, Record<string, Record<string, unknown>>>;
  const ids = new Set<string>();
  for (const [p, ops] of Object.entries(paths)) {
    for (const [m, op] of Object.entries(ops)) {
      if (m === "parameters") continue;
      if (!op.operationId) problems.push(`${m.toUpperCase()} ${p}: missing operationId`);
      else if (ids.has(op.operationId as string))
        problems.push(`${m.toUpperCase()} ${p}: duplicate operationId ${op.operationId}`);
      else ids.add(op.operationId as string);
      if (!op.responses || Object.keys(op.responses as object).length === 0)
        problems.push(`${m.toUpperCase()} ${p}: no responses`);
      if (!Array.isArray(op.tags) || op.tags.length === 0) problems.push(`${m.toUpperCase()} ${p}: no tags`);
    }
  }
  const walk = (node: unknown, at: string) => {
    if (Array.isArray(node)) node.forEach((n, i) => walk(n, `${at}[${i}]`));
    else if (node && typeof node === "object") {
      for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
        if (k === "$ref" && typeof v === "string" && !schemaAt(doc, v))
          problems.push(`${at}: unresolvable $ref ${v}`);
        walk(v, `${at}.${k}`);
      }
    }
  };
  walk(doc, "doc");
  return problems;
}

/** Validate a response body against the spec's declared schema for (path, method, status). */
export function checkResponse(
  doc: Record<string, unknown>,
  path: string,
  method: string,
  status: number,
  body: unknown,
  contentType = "application/json",
): SchemaError[] {
  const op = ((doc.paths as Record<string, Record<string, unknown>>)?.[path]?.[method.toLowerCase()] ??
    {}) as Record<string, unknown>;
  const responses = (op.responses ?? {}) as Record<string, Record<string, unknown>>;
  const resp = responses[String(status)] ?? responses[`${String(status)[0]}XX`] ?? responses.default;
  if (!resp)
    return [{ path: "", message: `no response declared for ${method.toUpperCase()} ${path} ${status}` }];
  const content = (resp.content ?? {}) as Record<string, Record<string, unknown>>;
  const ct = Object.keys(content).find((k) => k.startsWith(contentType)) ?? Object.keys(content)[0];
  const schema = ct ? content[ct]?.schema : undefined;
  if (!schema) return [];
  return validate(body, schema as Record<string, unknown>, { root: doc }).errors;
}

/** Bootstraps the mock ARAG server for tests (lazy import keeps this module light). */
export async function withMockArag<T>(
  fn: (mock: import("../arag/mock/server.ts").MockAragServer) => Promise<T>,
  opts: import("../arag/mock/server.ts").MockOptions = {},
): Promise<T> {
  const { startMockArag } = await import("../arag/mock/server.ts");
  const mock = await startMockArag(opts);
  try {
    return await fn(mock);
  } finally {
    await mock.close();
  }
}
