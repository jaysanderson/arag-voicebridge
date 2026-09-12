import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readVoiceEnv } from "../src/config.ts";
import {
  normaliseProspect,
  ProspectNotFoundError,
  ProspectRegistry,
  ValidationFailed,
  validateKey,
  validateProspect,
} from "../src/services/registry.ts";
import { Logger, Store } from "../vendor/arag-platform/src/index.ts";
import { describe, expect, it } from "./_expect.ts";

const log = new Logger({ level: "error", ringSize: 0, write: () => {} });
const voice = readVoiceEnv({});

const valid = {
  display_name: "Acme",
  kb_id: "kb-1",
  region: "europe-1",
  locale: "en-GB",
  greeting: "Hello",
  handoff_msg: "One moment",
};

function registry(cfg = voice) {
  const dir = mkdtempSync(join(tmpdir(), "vb-registry-"));
  return { reg: new ProspectRegistry({ store: new Store(dir), log, voice: cfg }), dir };
}

describe("validateProspect", () => {
  it("accepts a minimal valid entry", () => {
    expect(validateProspect(valid)).toEqual([]);
  });

  it("requires the six core fields", () => {
    const errors = validateProspect({ display_name: "Acme" });
    expect(errors.length).toBe(5);
    expect(errors.map((e) => e.path)).toContain("/kb_id");
  });

  it("rejects an unknown reranker and out-of-range numbers", () => {
    expect(validateProspect({ ...valid, reranker: "magic" })[0]!.path).toBe("/reranker");
    expect(validateProspect({ ...valid, max_tokens: 99999 })[0]!.path).toBe("/max_tokens");
    expect(validateProspect({ ...valid, temperature: 9 })[0]!.path).toBe("/temperature");
  });

  it("validates golden questions", () => {
    expect(validateProspect({ ...valid, golden_questions: "nope" })[0]!.path).toBe("/golden_questions");
    const bad = validateProspect({ ...valid, golden_questions: [{ q: "x", expect: "maybe" }] });
    expect(bad[0]!.path).toBe("/golden_questions/0/expect");
  });

  it("rejects non-objects", () => {
    expect(validateProspect("nope")[0]!.message).toBe("must be an object");
  });
});

describe("validateKey", () => {
  it("accepts registry-safe keys and rejects the rest", () => {
    expect(validateKey("acme-corp_1")).toEqual([]);
    expect(validateKey("Acme")).toHaveLength(1);
    expect(validateKey("a")).toHaveLength(1);
    expect(validateKey("../etc")).toHaveLength(1);
  });
});

describe("normaliseProspect", () => {
  it("drops unknown fields and coerces numbers", () => {
    const out = normaliseProspect({ ...valid, hacked: true, max_tokens: "200" });
    expect((out as unknown as Record<string, unknown>).hacked).toBe(undefined);
    expect(out.max_tokens).toBe(200);
  });
});

describe("ProspectRegistry", () => {
  it("creates, reads, replaces and deletes", () => {
    const { reg } = registry();
    const created = reg.create("acme", valid);
    expect(created.id).toBe("acme");
    expect(reg.get("acme")!.display_name).toBe("Acme");
    reg.replace("acme", { ...valid, display_name: "Acme 2" });
    expect(reg.require("acme").display_name).toBe("Acme 2");
    expect(reg.delete("acme")).toBe(true);
    expect(reg.get("acme")).toBe(undefined);
  });

  it("throws ProspectNotFoundError with the known keys", () => {
    const { reg } = registry();
    reg.create("acme", valid);
    try {
      reg.require("nope");
      throw new Error("should have thrown");
    } catch (err) {
      expect(err instanceof ProspectNotFoundError).toBe(true);
      expect((err as ProspectNotFoundError).known).toEqual(["acme"]);
    }
  });

  it("rejects invalid input with a field-level error list", () => {
    const { reg } = registry();
    try {
      reg.create("acme", { display_name: "x" });
      throw new Error("should have thrown");
    } catch (err) {
      expect(err instanceof ValidationFailed).toBe(true);
      expect((err as ValidationFailed).errors.length).toBeGreaterThan(0);
    }
  });

  it("seeds from the example file only when empty, preserving file order", () => {
    const { reg, dir } = registry();
    const file = join(dir, "seed.json");
    writeFileSync(
      file,
      JSON.stringify({
        zeta: { ...valid, display_name: "Zeta" },
        alpha: { ...valid, display_name: "Alpha" },
        broken: { display_name: "missing everything" },
      }),
    );
    expect(reg.seedFromFile(file)).toBe(2);
    expect(reg.keys()).toEqual(["zeta", "alpha"]);
    expect(reg.seedFromFile(file)).toBe(0);
  });

  it("applies VOICE_DEFAULT_AGENT_ID to the first seeded prospect's placeholder agent id", () => {
    const { reg, dir } = registry(readVoiceEnv({ VOICE_DEFAULT_AGENT_ID: "agent_live_123" }));
    const file = join(dir, "seed.json");
    writeFileSync(file, JSON.stringify({ first: { ...valid, agent_id: "elevenagent_REPLACE_ME" } }));
    reg.seedFromFile(file);
    expect(reg.require("first").agent_id).toBe("agent_live_123");
  });

  it("ignores a missing or malformed seed file", () => {
    const { reg, dir } = registry();
    expect(reg.seedFromFile(join(dir, "nope.json"))).toBe(0);
    const bad = join(dir, "bad.json");
    writeFileSync(bad, "{not json");
    expect(reg.seedFromFile(bad)).toBe(0);
  });

  it("publicView never leaks kb ids, regions or stored config names", () => {
    const { reg } = registry();
    const rec = reg.create("acme", { ...valid, ask_config: "acme_voice", avatar_id: "av1" });
    const pub = reg.publicView(rec);
    const json = JSON.stringify(pub);
    expect(json).not.toContain("kb-1");
    expect(json).not.toContain("acme_voice");
    expect(json).not.toContain("av1");
    expect(pub.scribe_ready).toBe(false);
    expect(pub.avatar_ready).toBe(false);
  });
});
