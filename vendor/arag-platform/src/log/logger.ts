/**
 * Structured JSON-line logger with level filtering, secret redaction, request-scoped
 * children and an in-memory ring buffer so admin panels can inspect recent logs.
 */
import type { LogLevel } from "../config/env.ts";

export interface LogRecord {
  ts: string;
  level: LogLevel;
  msg: string;
  [key: string]: unknown;
}

export interface LoggerOptions {
  level?: LogLevel;
  /** Ring buffer capacity (0 disables). */
  ringSize?: number;
  /** Sink for lines; defaults to stdout/stderr. */
  write?: (line: string, level: LogLevel) => void;
  /** Base fields attached to every record. */
  base?: Record<string, unknown>;
}

const ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const SECRET_KEY = /(token|key|secret|password|authorization|cookie)/i;

/** Redact values under secret-looking keys (recursively, shallow copy). */
export function redact(value: unknown, depth = 0): unknown {
  if (depth > 6 || value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = SECRET_KEY.test(k) && typeof v === "string" && v ? "•••" : redact(v, depth + 1);
  }
  return out;
}

export class Logger {
  level: LogLevel;
  readonly ring: LogRecord[] = [];
  readonly ringSize: number;
  private readonly write: (line: string, level: LogLevel) => void;
  private readonly base: Record<string, unknown>;

  constructor(opts: LoggerOptions = {}) {
    this.level = opts.level ?? "info";
    this.ringSize = opts.ringSize ?? 500;
    this.write =
      opts.write ??
      ((line, level) => {
        if (level === "error") process.stderr.write(`${line}\n`);
        else process.stdout.write(`${line}\n`);
      });
    this.base = opts.base ?? {};
  }

  enabled(level: LogLevel): boolean {
    return ORDER[level] >= ORDER[this.level];
  }

  child(fields: Record<string, unknown>): Logger {
    const c = new Logger({
      level: this.level,
      ringSize: 0,
      write: this.write,
      base: { ...this.base, ...fields },
    });
    // share the parent's ring buffer so request-scoped logs are inspectable
    (c as { ring: LogRecord[] }).ring = this.ring;
    (c as { ringSize: number }).ringSize = this.ringSize;
    return c;
  }

  log(level: LogLevel, msg: string, fields?: Record<string, unknown>): void {
    if (!this.enabled(level)) return;
    const rec: LogRecord = {
      ts: new Date().toISOString(),
      level,
      msg,
      ...this.base,
      ...(redact(fields ?? {}) as object),
    };
    if (this.ringSize > 0) {
      this.ring.push(rec);
      if (this.ring.length > this.ringSize) this.ring.splice(0, this.ring.length - this.ringSize);
    }
    this.write(JSON.stringify(rec), level);
  }

  debug(msg: string, fields?: Record<string, unknown>): void {
    this.log("debug", msg, fields);
  }
  info(msg: string, fields?: Record<string, unknown>): void {
    this.log("info", msg, fields);
  }
  warn(msg: string, fields?: Record<string, unknown>): void {
    this.log("warn", msg, fields);
  }
  error(msg: string, fields?: Record<string, unknown>): void {
    this.log("error", msg, fields);
  }

  /** Recent records, newest last, optionally filtered. */
  recent(opts: { level?: LogLevel; limit?: number; contains?: string } = {}): LogRecord[] {
    const min = opts.level ? ORDER[opts.level] : 0;
    const q = opts.contains?.toLowerCase();
    const rows = this.ring.filter(
      (r) => ORDER[r.level] >= min && (!q || JSON.stringify(r).toLowerCase().includes(q)),
    );
    return rows.slice(-(opts.limit ?? 200));
  }
}

/** Process-wide default logger; products may replace the level at startup. */
export const log = new Logger({ level: (process.env.LOG_LEVEL as LogLevel) || "info" });
