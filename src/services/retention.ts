/**
 * Retention and purge.
 *
 * Everything this product records — turns, listen sessions (with their transcripts) and golden
 * runs — is conversation data about real people. The stores are ring-capped, which bounds disk
 * but says nothing about *time*: a quiet deployment can hold a transcript for a year. Retention
 * puts a clock on it, purge lets an operator act now, and both are settings rather than code.
 *
 * A window of 0 means "keep until the ring evicts it", which is the historical behaviour and the
 * default, so an existing deployment does not silently start deleting its demo data.
 */
import type { Logger } from "../../vendor/arag-platform/src/index.ts";
import type { VoiceConfig } from "../config.ts";
import type { GoldenEvalStore } from "./goldenEval.ts";
import type { ListenService } from "./listen.ts";
import type { MetricsService } from "./metrics.ts";

export interface PurgeResult {
  turns: number;
  sessions: number;
  evals: number;
  at: string;
  /** Which windows were in force (days; 0 = unbounded). */
  windows: { turnDays: number; sessionDays: number; evalDays: number };
}

export type PurgeScope = "retention" | "turns" | "sessions" | "evals" | "all";

const DAY_MS = 24 * 60 * 60 * 1000;

export interface RetentionDeps {
  voice: VoiceConfig;
  log: Logger;
  metrics: MetricsService;
  listen: ListenService;
  evals: GoldenEvalStore;
}

export class RetentionService {
  private readonly deps: RetentionDeps;
  private timer: NodeJS.Timeout | null = null;

  constructor(deps: RetentionDeps) {
    this.deps = deps;
  }

  private cutoff(days: number): Date | null {
    return days > 0 ? new Date(Date.now() - days * DAY_MS) : null;
  }

  /** Apply the configured windows. Nothing with a window of 0 is touched. */
  applyRetention(actor = "schedule"): PurgeResult {
    const { voice, metrics, listen, evals } = this.deps;
    const turnCut = this.cutoff(voice.retentionTurnDays);
    const sessionCut = this.cutoff(voice.retentionSessionDays);
    const evalCut = this.cutoff(voice.retentionEvalDays);
    const result: PurgeResult = {
      turns: turnCut ? metrics.purgeBefore(turnCut) : 0,
      sessions: sessionCut ? listen.purgeBefore(sessionCut) : 0,
      evals: evalCut ? evals.purgeBefore(evalCut) : 0,
      at: new Date().toISOString(),
      windows: {
        turnDays: voice.retentionTurnDays,
        sessionDays: voice.retentionSessionDays,
        evalDays: voice.retentionEvalDays,
      },
    };
    if (result.turns || result.sessions || result.evals) {
      this.deps.log.info("retention.purged", { actor, ...result });
    }
    return result;
  }

  /**
   * Purge on demand. `retention` applies the windows; the other scopes delete everything of that
   * kind regardless of age, which is the operator's danger zone and is always audited.
   */
  purge(scope: PurgeScope, actor = "operator"): PurgeResult {
    if (scope === "retention") return this.applyRetention(actor);
    const { metrics, listen, evals, voice } = this.deps;
    const result: PurgeResult = {
      turns: scope === "turns" || scope === "all" ? metrics.reset() : 0,
      sessions: scope === "sessions" || scope === "all" ? listen.purgeAll() : 0,
      evals: scope === "evals" || scope === "all" ? evals.purgeAll() : 0,
      at: new Date().toISOString(),
      windows: {
        turnDays: voice.retentionTurnDays,
        sessionDays: voice.retentionSessionDays,
        evalDays: voice.retentionEvalDays,
      },
    };
    this.deps.log.warn("retention.purge", { actor, scope, ...result });
    return result;
  }

  /** What the Settings screen shows without changing anything. */
  preview(): { turnDays: number; sessionDays: number; evalDays: number; autoPurge: boolean } {
    const v = this.deps.voice;
    return {
      turnDays: v.retentionTurnDays,
      sessionDays: v.retentionSessionDays,
      evalDays: v.retentionEvalDays,
      autoPurge: v.retentionAutoPurge,
    };
  }

  /**
   * Run the windows hourly while `autoPurge` is on. The timer is unref'd so it never keeps a
   * test process or a container alive, and it re-reads the setting on every tick, so switching
   * auto-purge off takes effect without a restart like every other setting.
   */
  start(intervalMs = 60 * 60 * 1000): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      if (this.deps.voice.retentionAutoPurge) this.applyRetention("schedule");
    }, intervalMs);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}
