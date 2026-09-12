/**
 * RFC 9457 "problem details" errors — the one error format for every ARAG product API.
 *
 *   { "type": "https://arag.dev/problems/validation", "title": "Validation failed",
 *     "status": 400, "detail": "…", "instance": "/api/v1/…", "requestId": "…", "errors": [...] }
 */
export const PROBLEM_BASE = "https://arag.dev/problems/";

export class HttpError extends Error {
  readonly status: number;
  readonly type: string;
  readonly title: string;
  readonly extra: Record<string, unknown>;
  readonly headers: Record<string, string>;

  constructor(
    status: number,
    title: string,
    detail?: string,
    opts: { type?: string; extra?: Record<string, unknown>; headers?: Record<string, string> } = {},
  ) {
    super(detail ?? title);
    this.name = "HttpError";
    this.status = status;
    this.title = title;
    this.type = opts.type ?? `${PROBLEM_BASE}${slug(title)}`;
    this.extra = opts.extra ?? {};
    this.headers = opts.headers ?? {};
  }

  toProblem(instance?: string, requestId?: string): Record<string, unknown> {
    return {
      type: this.type,
      title: this.title,
      status: this.status,
      detail: this.message,
      ...(instance ? { instance } : {}),
      ...(requestId ? { requestId } : {}),
      ...this.extra,
    };
  }
}

function slug(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export const badRequest = (detail: string, extra?: Record<string, unknown>) =>
  new HttpError(400, "Bad request", detail, { extra });
export const validationError = (errors: Array<{ path: string; message: string }>, where = "body") =>
  new HttpError(
    400,
    "Validation failed",
    `Invalid ${where}: ${errors.map((e) => `${e.path || "/"} ${e.message}`).join("; ")}`,
    {
      type: `${PROBLEM_BASE}validation`,
      extra: { errors, in: where },
    },
  );
export const unauthorized = (detail = "Authentication required") =>
  new HttpError(401, "Unauthorized", detail, { headers: { "WWW-Authenticate": 'Bearer realm="arag"' } });
export const forbidden = (detail = "Forbidden") => new HttpError(403, "Forbidden", detail);
export const notFound = (what = "Resource") => new HttpError(404, "Not found", `${what} not found`);
export const conflict = (detail: string) => new HttpError(409, "Conflict", detail);
export const payloadTooLarge = (limit: number) =>
  new HttpError(413, "Payload too large", `Body exceeds ${limit} bytes`);
export const unsupportedMediaType = (detail: string) => new HttpError(415, "Unsupported media type", detail);
export const tooManyRequests = (retryAfterSec: number) =>
  new HttpError(429, "Too many requests", "Rate limit exceeded", {
    headers: { "Retry-After": String(retryAfterSec) },
  });
export const upstreamError = (detail: string, status = 502) =>
  new HttpError(status, "Upstream error", detail, { type: `${PROBLEM_BASE}upstream` });
export const serviceUnavailable = (detail: string) => new HttpError(503, "Service unavailable", detail);
export const internalError = (detail = "Internal server error") =>
  new HttpError(500, "Internal server error", detail);
