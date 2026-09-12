/**
 * Per-prospect ARAG clients.
 *
 * VoiceBridge is multi-tenant by design: every prospect points at its own Knowledge Box (and
 * possibly its own zone), so we keep one platform `AragClient` per `kb_id|region` pair rather
 * than a single global client. Clients are cheap and stateless; the pool just avoids rebuilding
 * them per turn and gives the admin health check a single place to look.
 *
 * With `ARAG_MOCK=1` every prospect resolves to the in-process mock KB, which is what makes the
 * demo, the tests and the golden evals runnable with no credentials at all.
 */
import {
  AragClient,
  DEFAULT_HOST_TEMPLATE,
  type Logger,
  type PlatformEnv,
} from "../../vendor/arag-platform/src/index.ts";
import type { VoiceConfig } from "../config.ts";

export interface MockTarget {
  url: string;
  kbId: string;
  apiKey: string;
}

export interface PoolDeps {
  env: PlatformEnv;
  voice: VoiceConfig;
  log: Logger;
  mock?: MockTarget | null;
  /** Request hook for usage counters (never receives the token). */
  onRequest?: (info: { method: string; path: string; status?: number; ms: number; error?: string }) => void;
}

export interface ProspectTarget {
  kb_id: string;
  region?: string;
}

export class AragClientPool {
  private readonly deps: PoolDeps;
  private readonly clients = new Map<string, AragClient>();

  constructor(deps: PoolDeps) {
    this.deps = deps;
  }

  get size(): number {
    return this.clients.size;
  }

  /** Effective region for a prospect (falls back to ARAG_REGION_DEFAULT). */
  regionFor(p: ProspectTarget): string {
    return p.region || this.deps.voice.aragRegionDefault || this.deps.env.arag.region;
  }

  /**
   * Base URL for a prospect: the mock in mock mode, the `ARAG_BASE_URL` override when the
   * prospect sits in the deployment's own zone, otherwise the zone host template.
   */
  baseUrlFor(p: ProspectTarget): string {
    if (this.deps.mock) return this.deps.mock.url;
    const region = this.regionFor(p);
    const env = this.deps.env.arag;
    if (env.baseUrl && region === env.region) return env.baseUrl.replace(/\/+$/, "");
    return DEFAULT_HOST_TEMPLATE.replace("{region}", region);
  }

  /** Get (or build) the client for a prospect. */
  for(p: ProspectTarget): AragClient {
    const baseUrl = this.baseUrlFor(p);
    const kbId = this.deps.mock ? this.deps.mock.kbId : p.kb_id;
    const key = `${kbId}|${baseUrl}`;
    let client = this.clients.get(key);
    if (!client) {
      client = new AragClient({
        kbId,
        apiKey: this.deps.mock ? this.deps.mock.apiKey : this.deps.env.arag.apiKey,
        baseUrl,
        timeoutMs: this.deps.env.arag.timeoutMs,
        onRequest: this.deps.onRequest,
      });
      this.clients.set(key, client);
      this.deps.log.debug("arag.client.created", { kbId, baseUrl });
    }
    return client;
  }

  /** Drop cached clients (used after registry edits change a KB id). */
  clear(): void {
    this.clients.clear();
  }
}
