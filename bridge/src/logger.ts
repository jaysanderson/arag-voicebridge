/**
 * Tiny structured logger. JSON lines so logs are grep-able and dashboard-able
 * (SPEC §13). No secrets are ever logged — callers pass only safe fields.
 */

import { config } from "./config.ts";

type Level = "debug" | "info" | "warn" | "error";

const ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

function enabled(level: Level): boolean {
  const threshold = ORDER[(config.logLevel as Level) ?? "info"] ?? ORDER.info;
  return ORDER[level] >= threshold;
}

function emit(level: Level, msg: string, fields?: Record<string, unknown>): void {
  if (!enabled(level)) return;
  const line = JSON.stringify({
    level,
    msg,
    ...fields,
  });
  // eslint-disable-next-line no-console
  (level === "error" ? console.error : console.log)(line);
}

export const log = {
  debug: (msg: string, fields?: Record<string, unknown>) => emit("debug", msg, fields),
  info: (msg: string, fields?: Record<string, unknown>) => emit("info", msg, fields),
  warn: (msg: string, fields?: Record<string, unknown>) => emit("warn", msg, fields),
  error: (msg: string, fields?: Record<string, unknown>) => emit("error", msg, fields),
};
