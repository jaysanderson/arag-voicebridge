/**
 * The settings store, the API key store and retention.
 *
 * The property that matters most here is not "the value round-trips" but "the change takes
 * effect" — so these tests assert against the live `PlatformEnv` / `VoiceConfig` objects the rest
 * of the product reads, not against the stored document.
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readVoiceEnv, type VoiceConfig } from "../src/config.ts";
import { ApiKeyStore, generateKey, keyPrefix } from "../src/services/apiKeys.ts";
import { liveBudget } from "../src/services/budget.ts";
import { GoldenEvalStore } from "../src/services/goldenEval.ts";
import { ListenService } from "../src/services/listen.ts";
import { MetricsService } from "../src/services/metrics.ts";
import type { ValidationFailed } from "../src/services/registry.ts";
import { RetentionService } from "../src/services/retention.ts";
import { maskSecret, SETTINGS_FIELDS, SETTINGS_GROUPS, SettingsService } from "../src/services/settings.ts";
import { Logger, type PlatformEnv, readEnv, Store } from "../vendor/arag-platform/src/index.ts";
import { describe, expect, it } from "./_expect.ts";

const log = new Logger({ level: "error", ringSize: 50, write: () => {} });

function harness(envOverrides: Record<string, string> = {}, voiceOverrides: Record<string, string> = {}) {
  const env: PlatformEnv = readEnv({
    ARAG_MOCK: "1",
    DATA_DIR: mkdtempSync(join(tmpdir(), "vb-settings-")),
    ADMIN_TOKEN: "t",
    ...envOverrides,
  });
  const voice: VoiceConfig = readVoiceEnv(voiceOverrides);
  const store = new Store(env.dataDir, { persist: false });
  let rewires = 0;
  const settings = new SettingsService({
    store,
    log,
    env,
    voice,
    // The same literal the config was read from, so "where did this value come from" is answerable.
    envSrc: { ...envOverrides, ...voiceOverrides },
    onRewire: () => {
      rewires++;
    },
  });
  settings.apply();
  return { env, voice, store, settings, rewires: () => rewires };
}

describe("the settings table", () => {
  it("covers every group, and every field belongs to one", () => {
    const ids = new Set(SETTINGS_GROUPS.map((g) => g.id));
    expect(ids.size).toBe(SETTINGS_GROUPS.length);
    for (const f of SETTINGS_FIELDS) expect(ids.has(f.group)).toBe(true);
    // Every group has at least one field: an empty card in Settings would be a bug, not a design.
    for (const g of SETTINGS_GROUPS) {
      expect(SETTINGS_FIELDS.some((f) => f.group === g.id)).toBe(true);
    }
  });

  it("names the environment variable that supplies each default", () => {
    for (const f of SETTINGS_FIELDS) {
      expect(f.env.length).toBeGreaterThan(0);
      expect(f.help.length).toBeGreaterThan(0);
    }
  });

  it("group+key is unique, so a patch can never be ambiguous", () => {
    const seen = new Set(SETTINGS_FIELDS.map((f) => `${f.group}.${f.key}`));
    expect(seen.size).toBe(SETTINGS_FIELDS.length);
  });
});

describe("SettingsService", () => {
  it("reports environment values as defaults until something overrides them", () => {
    const { settings } = harness({}, { BRAND_PRODUCT_NAME: "Contoso" });
    const branding = settings.describe().find((g) => g.id === "branding")!;
    const name = branding.fields.find((f) => f.key === "productName")!;
    expect(name.value).toBe("Contoso");
    expect(name.source).toBe("env");
    expect(settings.isOverridden("branding")).toBe(false);
  });

  /**
   * `BRAND_POWERED_BY=0` and "the variable is not set" produce the same effective value, and a
   * settings screen that cannot tell them apart tells the operator the wrong story.
   */
  it("distinguishes a variable set to a falsy value from one that is not set at all", () => {
    const { settings } = harness({}, { BRAND_POWERED_BY: "0" });
    const branding = settings.describe().find((g) => g.id === "branding")!;
    expect(branding.fields.find((f) => f.key === "poweredBy")!.source).toBe("env");
    expect(branding.fields.find((f) => f.key === "poweredBy")!.value).toBe(false);
    // Untouched by the environment, so it is the product's own default.
    expect(branding.fields.find((f) => f.key === "footerText")!.source).toBe("default");
  });

  it("says whether resetting a secret would restore one, without revealing it", () => {
    const conn = harness({ ARAG_API_KEY: "a-real-token-1234" })
      .settings.describe()
      .find((g) => g.id === "connection")!;
    const key = conn.fields.find((f) => f.key === "apiKey")!;
    expect(key.envSet).toBe(true);
    expect(JSON.stringify(key)).not.toContain("a-real-token-1234");
    const without = harness()
      .settings.describe()
      .find((g) => g.id === "connection")!;
    expect(without.fields.find((f) => f.key === "apiKey")!.envSet).toBe(false);
  });

  it("a stored override wins over the environment and takes effect in the live config", () => {
    const { settings, voice } = harness({}, { BRAND_PRODUCT_NAME: "Contoso" });
    settings.update({ branding: { productName: "Acme Assist" } });
    // The point of the whole design: the object the rest of the product reads has changed.
    expect(voice.branding.productName).toBe("Acme Assist");
    const name = settings
      .describe()
      .find((g) => g.id === "branding")!
      .fields.find((f) => f.key === "productName")!;
    expect(name.source).toBe("stored");
    expect(name.envValue).toBe("Contoso");
  });

  it("null resets one field to its environment default", () => {
    const { settings, voice } = harness({}, { BRAND_TAGLINE: "from the environment" });
    settings.update({ branding: { tagline: "typed in the UI" } });
    expect(voice.branding.tagline).toBe("typed in the UI");
    settings.update({ branding: { tagline: null } });
    expect(voice.branding.tagline).toBe("from the environment");
    expect(settings.isOverridden("branding")).toBe(false);
  });

  it("reset drops one group or all of them", () => {
    const { settings, voice, env } = harness();
    settings.update({ branding: { productName: "A" }, limits: { maxHistoryTurns: 12 } });
    expect(voice.maxHistoryTurns).toBe(12);
    settings.reset("limits");
    expect(voice.maxHistoryTurns).toBe(6);
    expect(voice.branding.productName).toBe("A");
    settings.reset();
    expect(voice.branding.productName).toBe("VoiceBridge");
    expect(env.rateLimitRps).toBe(5);
  });

  it("connection changes reach the ARAG environment and drop the cached clients", () => {
    const { settings, env, rewires } = harness();
    const before = rewires();
    settings.update({ connection: { region: "europe-1", timeoutMs: 9000 } });
    expect(env.arag.region).toBe("europe-1");
    expect(env.arag.timeoutMs).toBe(9000);
    expect(rewires()).toBeGreaterThan(before);
  });

  /** `rewiresClients` is behaviour, not decoration: only a change that moves a Knowledge Box does it. */
  it("does not drop the client pool for a change that cannot affect it", () => {
    const { settings, rewires } = harness();
    const before = rewires();
    settings.update({ branding: { productName: "Acme" }, limits: { maxHistoryTurns: 3 } });
    expect(rewires()).toBe(before);
    settings.update({ connection: { kbId: "another-knowledge-box" } });
    expect(rewires()).toBe(before + 1);
    // Writing the same value again is not a change.
    settings.update({ connection: { kbId: "another-knowledge-box" } });
    expect(rewires()).toBe(before + 1);
  });

  it("rejects an unknown group or field instead of silently dropping it", () => {
    const { settings } = harness();
    const errors = settings.validate({
      nonsense: { a: 1 },
      branding: { notAThing: "x" },
    } as never);
    expect(errors.map((e) => e.path)).toEqual(["/nonsense", "/branding/notAThing"]);
  });

  it("rejects a colour that is not safe to interpolate into CSS", () => {
    const { settings, voice } = harness();
    let threw = "";
    try {
      settings.update({ branding: { primaryColor: "red; background:url(evil)" } });
    } catch (err) {
      threw = (err as ValidationFailed).errors[0]!.path;
    }
    expect(threw).toBe("/branding/primaryColor");
    expect(voice.branding.primaryColor).toBe("");
    // A real colour is accepted.
    settings.update({ branding: { primaryColor: "#6b2fa0" } });
    expect(voice.branding.primaryColor).toBe("#6b2fa0");
  });

  /**
   * Branding is public (`GET /api/v1/branding`) and the kit puts `docsUrl` straight into an
   * `href`. An operator is trusted; that is not the same as being allowed to hand every future
   * viewer of the deployment a `javascript:` link.
   */
  it("refuses a branding URL that is not a path or http(s)", () => {
    const { settings, voice } = harness();
    for (const field of ["docsUrl", "logoUrl", "supportUrl"]) {
      const errors = settings.validate({ branding: { [field]: "javascript:alert(1)" } });
      expect(errors[0]!.path).toBe(`/branding/${field}`);
      expect(errors[0]!.message).toContain("http(s)");
    }
    expect(settings.validate({ branding: { docsUrl: "//evil.example" } })).toHaveLength(1);
    expect(settings.validate({ branding: { logoUrl: "data:text/html,<script>1</script>" } })).toHaveLength(1);
    // The shapes a partner actually uses are all fine.
    expect(settings.validate({ branding: { logoUrl: "/branding/logo.svg" } })).toEqual([]);
    expect(settings.validate({ branding: { docsUrl: "https://docs.acme.example" } })).toEqual([]);
    expect(settings.validate({ branding: { supportUrl: "" } })).toEqual([]);
    // Nothing unsafe was written on the way past.
    expect(voice.branding.docsUrl).toBe("/api/v1/docs");
  });

  it("enforces number ranges and enum options", () => {
    const { settings } = harness();
    expect(settings.validate({ limits: { maxHistoryTurns: 999 } })[0]!.message).toContain("at most");
    expect(settings.validate({ limits: { maxHistoryTurns: -1 } })[0]!.message).toContain("at least");
    expect(settings.validate({ limits: { maxHistoryTurns: "six" } })[0]!.message).toContain("number");
    expect(settings.validate({ connection: { reranker: "magic" } })[0]!.message).toContain("one of");
    expect(settings.validate({ retention: { autoPurge: "yes" } })[0]!.message).toContain("true or false");
  });

  /**
   * The invariant that keeps the product from shipping dead air: a turn must resolve before the
   * agent's tool call gives up. A settings change that breaks it is refused *and undone*.
   */
  it("refuses a turn budget that would outlive the agent tool timeout, and rolls back", () => {
    const { settings, voice } = harness();
    settings.update({ limits: { maxHistoryTurns: 4 } });
    let message = "";
    let path = "";
    try {
      settings.update({ limits: { turnTimeoutMs: 20_000, maxHistoryTurns: 9 } });
    } catch (err) {
      message = (err as ValidationFailed).errors[0]!.message;
      path = (err as ValidationFailed).errors[0]!.path;
    }
    // Named against the field, so the screen can put the error on an input rather than a summary.
    expect(path).toBe("/limits/turnTimeoutMs");
    expect(message).toContain("AGENT_TOOL_TIMEOUT_MS");
    expect(voice.turnTimeoutMs).toBe(6000);
    // The whole patch is rolled back, not half-applied.
    expect(voice.maxHistoryTurns).toBe(4);
  });

  it("never returns a secret, only whether one is set and enough to recognise it", () => {
    const { settings } = harness({ ARAG_API_KEY: "super-secret-value-1234" });
    const conn = settings.describe().find((g) => g.id === "connection")!;
    const key = conn.fields.find((f) => f.key === "apiKey")!;
    expect(key.type).toBe("secret");
    expect(key.set).toBe(true);
    expect(key.hint).toBe("••••1234");
    expect(JSON.stringify(conn)).not.toContain("super-secret-value-1234");
  });

  it("a rotated secret is written to the live config but still never returned", () => {
    const { settings, env } = harness({ ARAG_API_KEY: "old-key" });
    settings.update({ connection: { apiKey: "brand-new-token-9876" } });
    expect(env.arag.apiKey).toBe("brand-new-token-9876");
    expect(JSON.stringify(settings.describe())).not.toContain("brand-new-token-9876");
  });

  it("masks short secrets completely rather than showing most of one", () => {
    expect(maskSecret("")).toBe("");
    expect(maskSecret("abcd")).toBe("••••");
    expect(maskSecret("abcdefghijkl")).toBe("••••ijkl");
  });
});

describe("ApiKeyStore", () => {
  function keyHarness(apiKeys = "") {
    const env = readEnv({
      ARAG_MOCK: "1",
      DATA_DIR: mkdtempSync(join(tmpdir(), "vb-keys-")),
      API_KEYS: apiKeys,
    });
    const store = new Store(env.dataDir, { persist: false });
    const keys = new ApiKeyStore({ store, env, log });
    keys.seedFromEnv(env.apiKeys);
    return { env, keys };
  }

  it("mints a key with a recognisable prefix and returns the secret exactly once", () => {
    const { keys } = keyHarness();
    const { key, secret } = keys.create("Partner integration");
    expect(secret.startsWith("vbk_")).toBe(true);
    expect(key.prefix).toBe(keyPrefix(secret));
    expect(JSON.stringify(keys.list())).not.toContain(secret);
  });

  it("seeds from API_KEYS and marks where each key came from", () => {
    const { keys } = keyHarness("env-key-one,env-key-two");
    const list = keys.list();
    expect(list).toHaveLength(2);
    expect(list.every((k) => k.origin === "env")).toBe(true);
    keys.create("Minted here");
    expect(keys.list().find((k) => k.name === "Minted here")!.origin).toBe("store");
  });

  it("is the authority for authentication: env.apiKeys follows the store", () => {
    const { env, keys } = keyHarness("seeded-key");
    expect(env.apiKeys).toEqual(["seeded-key"]);
    const { key, secret } = keys.create("New");
    expect(env.apiKeys).toContain(secret);
    keys.revoke(key.id);
    expect(env.apiKeys).not.toContain(secret);
    // The record stays so the audit trail survives the revocation.
    expect(keys.list().find((k) => k.id === key.id)!.revoked).toBe(true);
  });

  it("mutates the same array object the platform authenticates against", () => {
    const { env, keys } = keyHarness("seeded-key");
    const original = env.apiKeys;
    keys.create("New");
    expect(env.apiKeys === original).toBe(true);
  });

  it("records last used, and samples rather than writing on every request", () => {
    const { keys } = keyHarness();
    const { key, secret } = keys.create("Busy");
    keys.touch(secret, "10.0.0.1");
    const after = keys.list().find((k) => k.id === key.id)!;
    expect(after.uses).toBe(1);
    expect(typeof after.lastUsedAt).toBe("string");
    keys.touch(secret, "10.0.0.1");
    keys.touch(secret, "10.0.0.1");
    expect(keys.list().find((k) => k.id === key.id)!.uses).toBe(1);
  });

  it("renames, reports how many keys can authenticate, and ignores unknown ids", () => {
    const { keys } = keyHarness();
    expect(keys.activeCount).toBe(0);
    const { key } = keys.create("Before");
    expect(keys.rename(key.id, "After")!.name).toBe("After");
    expect(keys.rename("nope", "x")).toBe(null);
    expect(keys.revoke("nope")).toBe(null);
    expect(keys.activeCount).toBe(1);
    expect(keys.secretOf(key.id)).toBe(keys.anyActive()!.secret);
    keys.revoke(key.id);
    expect(keys.activeCount).toBe(0);
    expect(keys.secretOf(key.id)).toBe(null);
  });

  /**
   * Adding a second key to `API_KEYS` and restarting used to overwrite the first one's record —
   * the id was its position in the list, and the counter only advanced for keys it had just added.
   * The first key stopped authenticating without anybody asking for that.
   */
  it("seeding is idempotent and order-independent, so adding a key never revokes another", () => {
    const dir = mkdtempSync(join(tmpdir(), "vb-seed-"));
    const first = readEnv({ ARAG_MOCK: "1", DATA_DIR: dir, API_KEYS: "keyAAA" });
    const store = new Store(dir, { persist: false });
    const keys = new ApiKeyStore({ store, env: first, log });
    keys.seedFromEnv(first.apiKeys);
    expect(keys.list()).toHaveLength(1);
    const originalId = keys.list()[0]!.id;

    // A restart with one more key in the variable, against the same store.
    const second = readEnv({ ARAG_MOCK: "1", DATA_DIR: dir, API_KEYS: "keyAAA,keyBBB" });
    const reopened = new ApiKeyStore({ store, env: second, log });
    reopened.seedFromEnv(second.apiKeys);

    const list = reopened.list();
    expect(list).toHaveLength(2);
    expect(list.every((k) => !k.revoked)).toBe(true);
    expect(list.some((k) => k.id === originalId)).toBe(true);
    // Both still authenticate.
    expect(second.apiKeys.includes("keyAAA")).toBe(true);
    expect(second.apiKeys.includes("keyBBB")).toBe(true);

    // And seeding again changes nothing at all.
    reopened.seedFromEnv(second.apiKeys);
    expect(reopened.list()).toHaveLength(2);
  });

  it("generates keys that do not collide", () => {
    const seen = new Set(Array.from({ length: 200 }, () => generateKey()));
    expect(seen.size).toBe(200);
  });
});

describe("RetentionService", () => {
  function retentionHarness(voiceOverrides: Record<string, string> = {}) {
    const env = readEnv({ ARAG_MOCK: "1", DATA_DIR: mkdtempSync(join(tmpdir(), "vb-ret-")) });
    const voice = readVoiceEnv(voiceOverrides);
    const store = new Store(env.dataDir, { persist: false });
    const metrics = new MetricsService({ store });
    const evals = new GoldenEvalStore(store);
    const listen = new ListenService({
      store,
      log,
      voice,
      prospect: () => ({
        id: "p",
        createdAt: "",
        updatedAt: "",
        display_name: "P",
        region: "r",
        locale: "en",
        greeting: "hi",
        handoff_msg: "bye",
      }),
      brief: async () => ({
        brief: null,
        citations: [],
        latency_ms: { retrieve: 0, first_token: 0, total: 0 },
      }),
    });
    return {
      voice,
      metrics,
      evals,
      listen,
      retention: new RetentionService({ voice, log, metrics, listen, evals }),
    };
  }

  const turn = {
    prospect: "p",
    total: 10,
    first_token: 5,
    retrieve: 2,
    citations: 1,
    handoff: false,
    guard_trip: false,
    source: "voice-answer" as const,
  };

  it("keeps everything when the windows are zero — the default must not delete demo data", () => {
    const { metrics, retention } = retentionHarness();
    metrics.record(turn);
    const result = retention.applyRetention();
    expect(result.turns).toBe(0);
    expect(metrics.size).toBe(1);
  });

  it("purges records older than the window and leaves fresh ones", () => {
    const { metrics, retention } = retentionHarness({ VOICE_RETENTION_TURN_DAYS: "7" });
    const old = metrics.record(turn);
    // Backdate one record past the window.
    metrics.query().items.find((t) => t.id === old.id);
    (old as { createdAt: string }).createdAt = new Date(Date.now() - 30 * 86_400_000).toISOString();
    metrics.record(turn);
    const result = retention.applyRetention();
    expect(result.turns).toBe(1);
    expect(metrics.size).toBe(1);
    expect(result.windows.turnDays).toBe(7);
  });

  it("purge scopes delete regardless of age", () => {
    const { metrics, listen, retention } = retentionHarness();
    metrics.record(turn);
    listen.create({ prospect: "p" });
    expect(retention.purge("turns").turns).toBe(1);
    expect(metrics.size).toBe(0);
    expect(listen.size).toBe(1);
    const all = retention.purge("all");
    expect(all.sessions).toBe(1);
    expect(listen.size).toBe(0);
  });

  it("the scheduled timer re-reads the setting, so switching it off needs no restart", () => {
    const { voice, metrics, retention } = retentionHarness({ VOICE_RETENTION_TURN_DAYS: "1" });
    const rec = metrics.record(turn);
    (rec as { createdAt: string }).createdAt = new Date(Date.now() - 5 * 86_400_000).toISOString();
    voice.retentionAutoPurge = false;
    retention.start(5);
    expect(metrics.size).toBe(1);
    retention.stop();
    expect(retention.preview().autoPurge).toBe(false);
  });
});

/**
 * A setting that is editable but inert is worse than one that is read-only: the screen says it
 * changed something and nothing changed. These pin the two values that were frozen at boot.
 */
describe("settings that are read after boot, not at boot", () => {
  it("the turn-log ring follows the setting rather than its boot-time value", () => {
    const env = readEnv({ ARAG_MOCK: "1", DATA_DIR: mkdtempSync(join(tmpdir(), "vb-ring-")) });
    const voice = readVoiceEnv({ VOICE_TURN_LOG_LIMIT: "10" });
    const store = new Store(env.dataDir, { persist: false });
    const metrics = new MetricsService({ store, cap: () => voice.turnLogLimit });
    const turn = {
      prospect: "p",
      total: 1,
      first_token: 1,
      retrieve: 1,
      citations: 0,
      handoff: false,
      guard_trip: false,
      source: "voice-answer" as const,
    };
    for (let i = 0; i < 12; i++) metrics.record(turn);
    expect(metrics.size).toBe(10);

    // Shrink the setting the way a settings PATCH does, and the very next turn enforces it.
    voice.turnLogLimit = 3;
    metrics.record(turn);
    expect(metrics.size).toBe(3);

    // And growing it takes effect too.
    voice.turnLogLimit = 8;
    for (let i = 0; i < 10; i++) metrics.record(turn);
    expect(metrics.size).toBe(8);
  });

  it("a per-route budget reads the current value on every request", () => {
    const voice = readVoiceEnv({ VOICE_BRIEF_RATE_RPS: "1", VOICE_BRIEF_RATE_BURST: "5" });
    const budget = liveBudget(() => ({ rps: voice.briefRps, burst: voice.briefBurst }));
    expect(budget.rps).toBe(1);
    // The platform spreads `route.opts.rateLimit` per request, so a getter stays live where a
    // plain number would have been frozen at route registration.
    expect({ ...budget }).toEqual({ rps: 1, burst: 5 });
    voice.briefRps = 20;
    voice.briefBurst = 40;
    expect({ ...budget }).toEqual({ rps: 20, burst: 40 });
  });
});
