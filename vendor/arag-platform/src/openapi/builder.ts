/**
 * Helpers to author OpenAPI 3.1 documents consistently across products.
 * The document is plain JSON authored in TypeScript; these helpers add the shared pieces
 * (problem schema, security schemes, standard responses, pagination) so every product matches
 * STANDARDS.md without copy-paste.
 */

export interface OpenApiInfo {
  title: string;
  version: string;
  description?: string;
  contact?: { name?: string; url?: string; email?: string };
  license?: { name: string; identifier?: string; url?: string };
}

export const ProblemSchema = {
  type: "object",
  description: "RFC 9457 problem details",
  required: ["type", "title", "status"],
  properties: {
    type: { type: "string", format: "uri", examples: ["https://arag.dev/problems/validation"] },
    title: { type: "string" },
    status: { type: "integer" },
    detail: { type: "string" },
    instance: { type: "string" },
    requestId: { type: "string" },
    errors: {
      type: "array",
      items: { type: "object", properties: { path: { type: "string" }, message: { type: "string" } } },
    },
  },
} as const;

export const standardResponses = {
  400: {
    description: "Validation failed",
    content: { "application/problem+json": { schema: { $ref: "#/components/schemas/Problem" } } },
  },
  401: {
    description: "Authentication required",
    content: { "application/problem+json": { schema: { $ref: "#/components/schemas/Problem" } } },
  },
  403: {
    description: "Forbidden",
    content: { "application/problem+json": { schema: { $ref: "#/components/schemas/Problem" } } },
  },
  404: {
    description: "Not found",
    content: { "application/problem+json": { schema: { $ref: "#/components/schemas/Problem" } } },
  },
  429: {
    description: "Rate limited",
    content: { "application/problem+json": { schema: { $ref: "#/components/schemas/Problem" } } },
  },
  502: {
    description: "Upstream (ARAG) error",
    content: { "application/problem+json": { schema: { $ref: "#/components/schemas/Problem" } } },
  },
} as const;

export const securitySchemes = {
  ApiKey: {
    type: "apiKey",
    in: "header",
    name: "X-API-Key",
    description: "Required only when API_KEYS is configured.",
  },
  Bearer: { type: "http", scheme: "bearer", description: "API key or admin token as a bearer token." },
  AdminToken: { type: "http", scheme: "bearer", description: "ADMIN_TOKEN; required for /admin routes." },
} as const;

export const PageQuery = {
  page: { name: "page", in: "query", schema: { type: "integer", minimum: 1, default: 1 } },
  pageSize: {
    name: "page_size",
    in: "query",
    schema: { type: "integer", minimum: 1, maximum: 200, default: 50 },
  },
} as const;

export function pageSchema(itemRef: string): Record<string, unknown> {
  return {
    type: "object",
    required: ["items", "page", "page_size", "total"],
    properties: {
      items: { type: "array", items: { $ref: itemRef } },
      page: { type: "integer" },
      page_size: { type: "integer" },
      total: { type: "integer" },
      next_page: { type: "boolean" },
    },
  };
}

export interface BuildOptions {
  info: OpenApiInfo;
  serverUrl?: string;
  basePath?: string;
  tags?: Array<{ name: string; description?: string }>;
  paths: Record<string, unknown>;
  schemas?: Record<string, unknown>;
}

/** Build a complete OpenAPI 3.1 document with the shared components merged in. */
export function buildOpenApi(opts: BuildOptions): Record<string, unknown> {
  return {
    openapi: "3.1.0",
    info: { license: { name: "Apache-2.0", identifier: "Apache-2.0" }, ...opts.info },
    servers: [{ url: opts.serverUrl ?? "/", description: "This deployment" }],
    tags: opts.tags ?? [],
    paths: opts.paths,
    components: {
      securitySchemes,
      schemas: {
        Problem: ProblemSchema,
        Health: {
          type: "object",
          required: ["ok"],
          properties: {
            ok: { type: "boolean" },
            version: { type: "string" },
            arag: { type: "object", additionalProperties: true },
            uptimeSec: { type: "number" },
          },
        },
        Job: {
          type: "object",
          required: ["id", "kind", "status", "createdAt", "updatedAt", "progress"],
          properties: {
            id: { type: "string" },
            kind: { type: "string" },
            status: { type: "string", enum: ["queued", "running", "succeeded", "failed", "cancelled"] },
            progress: { type: "number", minimum: 0, maximum: 1 },
            stage: { type: "string" },
            message: { type: "string" },
            input: { type: "object", additionalProperties: true },
            result: {},
            error: { type: "object", properties: { message: { type: "string" }, kind: { type: "string" } } },
            events: { type: "array", items: { $ref: "#/components/schemas/JobEvent" } },
            createdAt: { type: "string", format: "date-time" },
            updatedAt: { type: "string", format: "date-time" },
            finishedAt: { type: "string", format: "date-time" },
            durationsMs: { type: "object", additionalProperties: { type: "number" } },
          },
        },
        JobEvent: {
          type: "object",
          required: ["ts", "stage", "status"],
          properties: {
            ts: { type: "string", format: "date-time" },
            stage: { type: "string" },
            status: { type: "string", enum: ["start", "progress", "ok", "error", "skip"] },
            message: { type: "string" },
            ms: { type: "number" },
            data: {},
          },
        },
        LogRecord: {
          type: "object",
          required: ["ts", "level", "msg"],
          properties: { ts: { type: "string" }, level: { type: "string" }, msg: { type: "string" } },
          additionalProperties: true,
        },
        ...(opts.schemas ?? {}),
      },
    },
  };
}

/** Shorthand for a JSON request body. */
export function jsonBody(schema: unknown, required = true, description?: string): Record<string, unknown> {
  return { required, description, content: { "application/json": { schema } } };
}

/** Shorthand for a JSON response. */
export function jsonResponse(schema: unknown, description = "OK"): Record<string, unknown> {
  return { description, content: { "application/json": { schema } } };
}

/** Resolve a `$ref` or inline schema inside a doc (for validation and contract tests). */
export function schemaAt(doc: Record<string, unknown>, ref: string): Record<string, unknown> | undefined {
  let node: unknown = doc;
  for (const part of ref.replace(/^#\//, "").split("/")) {
    node = (node as Record<string, unknown> | undefined)?.[part.replace(/~1/g, "/")];
  }
  return node as Record<string, unknown> | undefined;
}

/** Fetch the request-body / query / path schemas of an operation for route validation. */
export function operationSchemas(
  doc: Record<string, unknown>,
  path: string,
  method: string,
): { body?: unknown; query?: unknown; params?: unknown } {
  const op = ((doc.paths as Record<string, Record<string, unknown>>)?.[path]?.[method.toLowerCase()] ??
    {}) as Record<string, unknown>;
  const out: { body?: unknown; query?: unknown; params?: unknown } = {};
  const body = (op.requestBody as Record<string, unknown> | undefined)?.content as
    | Record<string, Record<string, unknown>>
    | undefined;
  const json = body?.["application/json"]?.schema;
  if (json) out.body = json;
  const params = [
    ...(((doc.paths as Record<string, Record<string, unknown>>)?.[path]?.parameters as unknown[]) ?? []),
    ...((op.parameters as unknown[]) ?? []),
  ] as Array<Record<string, unknown>>;
  const build = (where: string) => {
    const props: Record<string, unknown> = {};
    const required: string[] = [];
    for (const p of params) {
      const pp = typeof p.$ref === "string" ? (schemaAt(doc, p.$ref) as Record<string, unknown>) : p;
      if (pp.in !== where) continue;
      props[pp.name as string] = pp.schema ?? {};
      if (pp.required) required.push(pp.name as string);
    }
    return Object.keys(props).length
      ? { type: "object", properties: props, required, additionalProperties: where === "query" }
      : undefined;
  };
  out.query = build("query");
  out.params = build("path");
  return out;
}
