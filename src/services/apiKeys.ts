/**
 * The API key store.
 *
 * `API_KEYS` was a placeholder: a comma-separated environment variable with no names, no
 * revocation and no way to tell which key a caller used. This replaces it with a real store —
 * create, name, revoke, last used — while keeping the variable as the *seed*, so an existing
 * deployment keeps working and its keys simply show up in the UI as "from the environment".
 *
 * How it drives authentication: the platform's `App` authenticates against `env.apiKeys`, and it
 * holds the same array object this store was given. Activating or revoking a key therefore
 * rewrites that array in place and the very next request is authenticated against the new set —
 * no restart, no re-wiring.
 *
 * Secrets are kept in the JSON store in full, because a constant-time comparison needs the
 * plaintext and because the ElevenLabs agent push has to put a real key into the tool's
 * `X-API-Key` header. That is the same trust level as the `.env` file the store replaces; the
 * API never returns a secret after the one response that creates it.
 */
import { randomBytes } from "node:crypto";
import type {
  Collection,
  Logger,
  PlatformEnv,
  Store,
  StoredDoc,
} from "../../vendor/arag-platform/src/index.ts";

export interface ApiKeyRecord extends StoredDoc {
  name: string;
  /** The secret itself. Never leaves the server except in the create response. */
  secret: string;
  /** The leading characters, enough to recognise a key in a list. */
  prefix: string;
  /** Seeded from API_KEYS, or minted here. */
  origin: "env" | "store";
  lastUsedAt?: string;
  lastUsedIp?: string;
  uses: number;
  revokedAt?: string;
}

/** What the API returns: everything except the secret. */
export interface ApiKeyView {
  id: string;
  name: string;
  prefix: string;
  origin: "env" | "store";
  createdAt: string;
  lastUsedAt: string | null;
  uses: number;
  revoked: boolean;
  revokedAt: string | null;
}

/** How often a key's "last used" is written back. A turn should not cost a store flush. */
const TOUCH_INTERVAL_MS = 30_000;

export function generateKey(): string {
  return `vbk_${randomBytes(24).toString("base64url")}`;
}

export function keyPrefix(secret: string): string {
  return secret.slice(0, 10);
}

export class ApiKeyStore {
  private readonly col: Collection<ApiKeyRecord>;
  private readonly env: PlatformEnv;
  private readonly log: Logger;
  private readonly lastTouch = new Map<string, number>();

  constructor(deps: { store: Store; env: PlatformEnv; log: Logger }) {
    this.col = deps.store.collection<ApiKeyRecord>("api-keys");
    this.env = deps.env;
    this.log = deps.log;
  }

  /**
   * Take over from `API_KEYS`: record any environment key not already stored, then make the
   * store the authority for authentication.
   */
  seedFromEnv(keys: string[]): number {
    const known = new Set(this.col.list().map((k) => k.secret));
    let seeded = 0;
    for (const secret of keys) {
      if (!secret || known.has(secret)) continue;
      this.col.put({
        id: `env-${seeded + 1}`,
        name: keys.length > 1 ? `API_KEYS #${seeded + 1}` : "API_KEYS",
        secret,
        prefix: keyPrefix(secret),
        origin: "env",
        uses: 0,
      });
      seeded++;
    }
    if (seeded) this.log.info("apikeys.seeded", { count: seeded });
    this.sync();
    return seeded;
  }

  /**
   * Rewrite the live `env.apiKeys` array in place with the active secrets. The platform's
   * authenticator reads that same array, so this is what makes a revocation immediate.
   */
  sync(): void {
    const active = this.col.list().filter((k) => !k.revokedAt);
    this.env.apiKeys.splice(0, this.env.apiKeys.length, ...active.map((k) => k.secret));
  }

  list(): ApiKeyView[] {
    return this.col.list({ sort: (a, b) => b.createdAt.localeCompare(a.createdAt) }).map((k) => this.view(k));
  }

  get(id: string): ApiKeyRecord | undefined {
    return this.col.get(id);
  }

  /** The secret of an active key, for server-side use (the ElevenLabs tool header). */
  secretOf(id: string): string | null {
    const k = this.col.get(id);
    return k && !k.revokedAt ? k.secret : null;
  }

  /** Any active key — used when the agent push is not told which key to wire in. */
  anyActive(): ApiKeyRecord | null {
    return this.col.list({ filter: (k) => !k.revokedAt, limit: 1 })[0] ?? null;
  }

  view(k: ApiKeyRecord): ApiKeyView {
    return {
      id: k.id,
      name: k.name,
      prefix: k.prefix,
      origin: k.origin,
      createdAt: k.createdAt,
      lastUsedAt: k.lastUsedAt ?? null,
      uses: k.uses,
      revoked: Boolean(k.revokedAt),
      revokedAt: k.revokedAt ?? null,
    };
  }

  /** Mint a key. The secret is returned exactly once, here. */
  create(name: string, actor = "operator"): { key: ApiKeyView; secret: string } {
    const secret = generateKey();
    const rec = this.col.put({
      id: `key_${randomBytes(8).toString("hex")}`,
      name: name.trim() || "Unnamed key",
      secret,
      prefix: keyPrefix(secret),
      origin: "store",
      uses: 0,
    });
    this.sync();
    this.log.info("apikey.created", { actor, id: rec.id, name: rec.name });
    return { key: this.view(rec), secret };
  }

  rename(id: string, name: string, actor = "operator"): ApiKeyView | null {
    const rec = this.col.update(id, { name: name.trim() || "Unnamed key" } as Partial<ApiKeyRecord>);
    if (!rec) return null;
    this.log.info("apikey.renamed", { actor, id, name: rec.name });
    return this.view(rec);
  }

  /**
   * Revoke a key. The record stays — a revoked key that vanished from the list would take its
   * own audit trail with it — but it leaves `env.apiKeys` immediately.
   */
  revoke(id: string, actor = "operator"): ApiKeyView | null {
    const rec = this.col.get(id);
    if (!rec) return null;
    if (rec.revokedAt) return this.view(rec);
    const updated = this.col.update(id, { revokedAt: new Date().toISOString() } as Partial<ApiKeyRecord>);
    this.sync();
    this.log.info("apikey.revoked", { actor, id, name: rec.name });
    return updated ? this.view(updated) : null;
  }

  /** Record that a key was just used. Throttled so a busy deployment does not flush per request. */
  touch(secret: string, ip?: string): void {
    const now = Date.now();
    const last = this.lastTouch.get(secret) ?? 0;
    if (now - last < TOUCH_INTERVAL_MS) return;
    this.lastTouch.set(secret, now);
    const rec = this.col.list({ filter: (k) => k.secret === secret, limit: 1 })[0];
    if (!rec) return;
    this.col.update(rec.id, {
      lastUsedAt: new Date(now).toISOString(),
      lastUsedIp: ip,
      uses: rec.uses + 1,
    } as Partial<ApiKeyRecord>);
  }

  get size(): number {
    return this.col.size;
  }

  /** How many keys can authenticate right now. Zero means the public API is open. */
  get activeCount(): number {
    return this.col.list({ filter: (k) => !k.revokedAt }).length;
  }
}
