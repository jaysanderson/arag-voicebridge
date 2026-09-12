/**
 * Unit tests for the listening service: the throttle policy (pure), and session lifecycle,
 * transcript handling, citation accumulation and stats (with the brief injected).
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readVoiceEnv } from "../src/config.ts";
import { exportMarkdown } from "../src/routes/listen.ts";
import type { BriefResult } from "../src/services/brief.ts";
import {
  DEFAULT_THROTTLE,
  decideRefresh,
  isUsableBrief,
  jaccard,
  ListenService,
  ListenSessionEnded,
  ListenSessionNotFound,
  lastWords,
  mergeCitations,
  normWords,
} from "../src/services/listen.ts";
import type { ProspectRecord } from "../src/types.ts";
import { Logger, Store } from "../vendor/arag-platform/src/index.ts";
import { describe, expect, it } from "./_expect.ts";

const log = new Logger({ level: "error", ringSize: 0, write: () => {} });
const voice = readVoiceEnv({});

const prospect: ProspectRecord = {
  id: "acme",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  display_name: "Acme",
  kb_id: "kb-1",
  region: "europe-1",
  locale: "en-GB",
  greeting: "Hello",
  handoff_msg: "One moment",
};

function briefResult(over: Partial<BriefResult> = {}): BriefResult {
  return {
    brief: { summary: "They want binder jetting for stainless parts.", key_points: ["Shop System"] },
    citations: [{ title: "Desktop Metal Shop System", url: "", score: 0.8 }],
    latency_ms: { retrieve: 10, first_token: 20, total: 30 },
    ...over,
  };
}

interface Harness {
  service: ListenService;
  calls: Array<{ text: string; transcript?: string; prev?: unknown }>;
  setNow: (ms: number) => void;
  setBrief: (fn: () => Promise<BriefResult>) => void;
}

function harness(over: { throttle?: Partial<typeof DEFAULT_THROTTLE>; cap?: number } = {}): Harness {
  const calls: Harness["calls"] = [];
  let now = 1_000_000;
  let brief = async () => briefResult();
  const service = new ListenService({
    store: new Store(mkdtempSync(join(tmpdir(), "vb-listen-"))),
    log,
    voice,
    prospect: (key) => {
      if (key !== "acme") throw new Error(`unknown prospect ${key}`);
      return prospect;
    },
    brief: async (req) => {
      calls.push({ text: req.text, transcript: req.transcript, prev: req.prev });
      return brief();
    },
    now: () => now,
    throttle: over.throttle,
    cap: over.cap,
  });
  return {
    service,
    calls,
    setNow: (ms) => {
      now = ms;
    },
    setBrief: (fn) => {
      brief = fn;
    },
  };
}

const flush = () => new Promise((r) => setTimeout(r, 5));

describe("throttle helpers", () => {
  it("takes the last N words", () => {
    expect(lastWords("one two three four", 2)).toBe("three four");
    expect(lastWords("", 5)).toBe("");
  });

  it("normalises punctuation and case for comparison", () => {
    expect(normWords("We're printing STAINLESS steel!")).toBe("we re printing stainless steel");
  });

  it("scores word-set overlap", () => {
    expect(jaccard("a b c", "a b c")).toBe(1);
    expect(jaccard("a b c", "d e f")).toBe(0);
    expect(jaccard("", "a")).toBe(0);
    expect(jaccard("a b c d", "a b c e")).toBeGreaterThan(0.5);
  });
});

describe("decideRefresh", () => {
  const state = { lastNorm: "", lastFireAt: 0 };

  it("refreshes once there is enough to ask about", () => {
    const d = decideRefresh("we need stainless steel parts", state, 1000);
    expect(d.refresh).toBe(true);
    expect(d.reason).toBe("ok");
  });

  it("waits for a few words before spending an LLM call", () => {
    expect(decideRefresh("hi there", state, 1000).reason).toBe("too-few-words");
  });

  it("enforces the minimum gap and reports how long to wait", () => {
    const d = decideRefresh("a completely different sentence here", { lastNorm: "x", lastFireAt: 900 }, 1000);
    expect(d.refresh).toBe(false);
    expect(d.reason).toBe("too-soon");
    expect(d.waitMs).toBe(DEFAULT_THROTTLE.minGapMs - 100);
  });

  it("skips an unchanged window", () => {
    const norm = normWords("we need stainless steel parts");
    expect(
      decideRefresh("we need stainless steel parts", { lastNorm: norm, lastFireAt: 0 }, 9999).reason,
    ).toBe("unchanged");
  });

  it("skips a window that is merely the same thing again", () => {
    const first = "we need stainless steel parts for the manifold and the bracket line next quarter";
    const second = "we need stainless steel parts for the manifold and the bracket line next quarter too";
    const d = decideRefresh(second, { lastNorm: normWords(first), lastFireAt: 0 }, 9999);
    expect(jaccard(normWords(first), normWords(second))).toBeGreaterThan(DEFAULT_THROTTLE.jaccardMax);
    expect(d.reason).toBe("too-similar");
  });

  it("refreshes when the conversation genuinely moves on", () => {
    const first = "we need stainless steel parts for the manifold";
    const second = "what does the sintering furnace cost to run each month";
    expect(decideRefresh(second, { lastNorm: normWords(first), lastFireAt: 0 }, 9999).refresh).toBe(true);
  });
});

describe("isUsableBrief", () => {
  it("accepts a brief with something readable and rejects the rest", () => {
    expect(isUsableBrief({ summary: "something" })).toBe(true);
    expect(isUsableBrief({ key_points: ["a"] })).toBe(true);
    expect(isUsableBrief({ summary: "   ", key_points: [] })).toBe(false);
    expect(isUsableBrief(null)).toBe(false);
    expect(isUsableBrief("text")).toBe(false);
  });
});

describe("mergeCitations", () => {
  it("dedupes by title+url and keeps the best score", () => {
    const merged = mergeCitations(
      [{ title: "A", url: "", score: 0.3 }],
      [
        { title: "A", url: "", score: 0.7 },
        { title: "B", url: "", score: 0.5 },
      ],
    );
    expect(merged).toHaveLength(2);
    expect(merged.find((c) => c.title === "A")!.score).toBe(0.7);
  });

  it("drops untitled citations and caps the list", () => {
    const many = Array.from({ length: 20 }, (_, i) => ({ title: `T${i}`, url: "", score: 0.1 }));
    expect(mergeCitations([], [...many, { title: "", url: "u", score: 1 }])).toHaveLength(12);
  });
});

describe("ListenService", () => {
  it("creates a session seeded from the prospect", () => {
    const { service } = harness();
    const s = service.create({ prospect: "acme" });
    expect(s.status).toBe("live");
    expect(s.locale).toBe("en-GB");
    expect(s.briefVersion).toBe(0);
    expect(s.brief).toBe(null);
    expect(service.size).toBe(1);
  });

  it("refreshes the brief when the first real sentence arrives", async () => {
    const { service, calls } = harness();
    const s = service.create({ prospect: "acme" });
    const { decision } = service.append(s.id, [
      { speaker: "caller", text: "we print stainless steel brackets and sintering is our bottleneck" },
    ]);
    expect(decision.refresh).toBe(true);
    await flush();
    const after = service.view(service.require(s.id));
    expect(after.briefVersion).toBe(1);
    expect(after.citations).toHaveLength(1);
    expect(after.stats.refreshes).toBe(1);
    expect(after.stats.lastLatencyMs).toBe(30);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.transcript).toContain("caller:");
  });

  it("passes the previous brief back so it is refined, not restarted", async () => {
    const { service, calls, setNow } = harness();
    const s = service.create({ prospect: "acme" });
    service.append(s.id, [{ speaker: "caller", text: "we print stainless steel brackets every week" }]);
    await flush();
    setNow(1_010_000);
    service.append(s.id, [{ speaker: "caller", text: "what does the sintering furnace cost to run" }]);
    await flush();
    expect(calls).toHaveLength(2);
    expect(calls[1]!.prev).toMatchObject({ summary: "They want binder jetting for stainless parts." });
  });

  it("throttles a chatty client instead of firing a refresh per chunk", async () => {
    const { service, calls } = harness();
    const s = service.create({ prospect: "acme" });
    service.append(s.id, [{ speaker: "caller", text: "we print stainless steel brackets every week" }]);
    await flush();
    const second = service.append(s.id, [{ speaker: "caller", text: "and we also print manifolds" }]);
    expect(second.decision.reason).toBe("too-soon");
    expect(calls).toHaveLength(1);
    expect(service.view(service.require(s.id)).stats.skipped).toBe(1);
  });

  it("replaces interim hypotheses instead of accumulating them", () => {
    const { service } = harness();
    const s = service.create({ prospect: "acme" });
    service.append(s.id, [{ speaker: "caller", text: "we print stain", final: false }]);
    service.append(s.id, [{ speaker: "caller", text: "we print stainless", final: false }]);
    service.append(s.id, [{ speaker: "caller", text: "we print stainless steel", final: true }]);
    const session = service.require(s.id);
    expect(session.transcript).toHaveLength(1);
    expect(session.transcript[0]!.text).toBe("we print stainless steel");
  });

  it("keeps the transcript text out of the brief until a chunk is final", async () => {
    const { service, calls } = harness();
    const s = service.create({ prospect: "acme" });
    service.append(s.id, [
      { speaker: "caller", text: "we need titanium parts for an aerospace customer", final: false },
    ]);
    await flush();
    expect(calls[0]!.transcript).toBe("");
  });

  it("counts failures without losing the brief already on screen", async () => {
    const { service, setBrief, setNow } = harness();
    const s = service.create({ prospect: "acme" });
    service.append(s.id, [{ speaker: "caller", text: "we print stainless steel brackets every week" }]);
    await flush();
    setBrief(async () => {
      throw new Error("upstream exploded");
    });
    setNow(1_010_000);
    service.append(s.id, [{ speaker: "caller", text: "what does the sintering furnace cost to run" }]);
    await flush();
    const after = service.view(service.require(s.id));
    expect(after.stats.failures).toBe(1);
    expect(after.briefVersion).toBe(1);
    expect((after.brief as { summary: string }).summary).toContain("binder jetting");
  });

  it("records a refresh that returned nothing usable as a failure", async () => {
    const { service, setBrief } = harness();
    setBrief(async () => briefResult({ brief: null }));
    const s = service.create({ prospect: "acme" });
    service.append(s.id, [{ speaker: "caller", text: "we print stainless steel brackets every week" }]);
    await flush();
    const after = service.view(service.require(s.id));
    expect(after.stats.failures).toBe(1);
    expect(after.briefVersion).toBe(0);
  });

  it("emits transcript, status and brief events to subscribers", async () => {
    const { service } = harness();
    const s = service.create({ prospect: "acme" });
    const seen: string[] = [];
    const off = service.subscribe(s.id, (e) =>
      seen.push(e.type === "status" ? `status:${e.status}` : e.type),
    );
    service.append(s.id, [{ speaker: "caller", text: "we print stainless steel brackets every week" }]);
    await flush();
    off();
    expect(seen).toContain("transcript");
    expect(seen).toContain("status:refreshing");
    expect(seen).toContain("brief");
  });

  it("signals a skipped refresh instead of blanking the brief, and says why", async () => {
    // The contract the Live view's "showing the last good brief" indicator reads: a refresh that
    // comes back with nothing usable, or fails outright, emits status:skipped and leaves the brief.
    const { service, setBrief, setNow } = harness();
    const s = service.create({ prospect: "acme" });
    service.append(s.id, [{ speaker: "caller", text: "we print stainless steel brackets every week" }]);
    await flush();
    const good = service.view(service.require(s.id));
    expect(good.briefVersion).toBe(1);

    const seen: string[] = [];
    const off = service.subscribe(s.id, (e) => {
      if (e.type === "status") seen.push(`${e.status}:${e.reason ?? ""}`);
    });
    setBrief(async () => briefResult({ brief: null }));
    setNow(1_100_000);
    service.append(s.id, [{ speaker: "caller", text: "and titanium parts for an aerospace customer" }]);
    await flush();

    setBrief(async () => {
      throw new Error("upstream is down");
    });
    setNow(1_200_000);
    service.append(s.id, [{ speaker: "caller", text: "what does the sintering furnace cost to run" }]);
    await flush();
    off();

    expect(seen).toContain("skipped:nothing-relevant-yet");
    expect(seen).toContain("skipped:refresh-failed");
    const after = service.view(service.require(s.id));
    expect(after.brief).toEqual(good.brief);
    expect(after.briefVersion).toBe(1);
    expect(after.stats.failures).toBe(2);
  });

  it("ends a session, keeps the summary and refuses further transcript", async () => {
    const { service } = harness();
    const s = service.create({ prospect: "acme" });
    service.append(s.id, [{ speaker: "caller", text: "we print stainless steel brackets every week" }]);
    await flush();
    const ended = service.end(s.id);
    expect(ended.status).toBe("ended");
    expect(ended.briefVersion).toBe(1);
    let threw = false;
    try {
      service.append(s.id, [{ speaker: "caller", text: "one more thing about titanium parts" }]);
    } catch (err) {
      threw = err instanceof ListenSessionEnded;
    }
    expect(threw).toBe(true);
    expect(service.end(s.id).status).toBe("ended");
  });

  it("throws ListenSessionNotFound for an unknown id", () => {
    const { service } = harness();
    let threw = false;
    try {
      service.require("nope");
    } catch (err) {
      threw = err instanceof ListenSessionNotFound;
    }
    expect(threw).toBe(true);
  });

  it("lists recent sessions and filters by prospect", () => {
    const { service } = harness();
    service.create({ prospect: "acme" });
    service.create({ prospect: "acme" });
    expect(service.list()).toHaveLength(2);
    expect(service.list({ prospect: "other" })).toHaveLength(0);
    expect(service.list({ limit: 1 })).toHaveLength(1);
  });

  it("keeps a capped brief history for the admin panel", async () => {
    const { service, setNow } = harness({ throttle: { minGapMs: 0 } });
    const s = service.create({ prospect: "acme" });
    // Each turn must move the conversation on, or the throttle (correctly) skips it.
    const turns = [
      "we print stainless steel brackets and sintering is the bottleneck",
      "what does the furnace cost to run every month in energy",
      "later we will need titanium for an aerospace customer as well",
    ];
    for (const [i, text] of turns.entries()) {
      setNow(1_000_000 + i * 10_000);
      service.append(s.id, [{ speaker: "caller", text }]);
      await flush();
    }
    const admin = service.adminView(service.require(s.id));
    expect(admin.briefHistory.length).toBe(3);
    expect(admin.briefHistory[0]!.version).toBe(1);
    expect(admin.briefHistory[0]!.latencyMs).toBe(30);
  });

  it("retires ended sessions before the store can evict a live one", () => {
    const { service } = harness({ cap: 3 });
    const first = service.create({ prospect: "acme" });
    const second = service.create({ prospect: "acme" });
    service.end(first.id);
    service.create({ prospect: "acme" });
    // The fourth session must cost the ended one, not the older call that is still running.
    const fourth = service.create({ prospect: "acme" });
    expect(service.get(first.id)).toBe(undefined);
    expect(service.get(second.id) !== undefined).toBe(true);
    expect(service.get(fourth.id) !== undefined).toBe(true);
    expect(service.size).toBe(3);
  });

  it("never exposes throttle bookkeeping through the API view", () => {
    const { service } = harness();
    const s = service.create({ prospect: "acme" });
    expect(JSON.stringify(s)).not.toContain("lastFireAt");
  });
});

describe("conversations query", () => {
  /** Three sessions with distinct prospects, transcripts and states, to filter and sort over. */
  async function seeded() {
    const h = harness();
    const a = h.service.create({ prospect: "acme" });
    h.service.append(a.id, [{ speaker: "caller", text: "we print stainless steel brackets every week" }]);
    await flush();
    h.setNow(1_100_000);
    const b = h.service.create({ prospect: "acme" });
    h.service.append(b.id, [{ speaker: "caller", text: "titanium aerospace parts and a sintering furnace" }]);
    await flush();
    h.service.end(b.id);
    h.setNow(1_200_000);
    const c = h.service.create({ prospect: "acme" });
    return { ...h, a, b, c };
  }

  it("returns newest first with a total independent of the page", async () => {
    const { service } = await seeded();
    const page = service.query({ limit: 2 });
    expect(page.total).toBe(3);
    expect(page.items.length).toBe(2);
    const all = service.query({ limit: 50 });
    expect(all.items[0]!.createdAt >= all.items[1]!.createdAt).toBe(true);
  });

  it("pages with offset without dropping or repeating a session", async () => {
    const { service } = await seeded();
    const first = service.query({ limit: 2, offset: 0 }).items.map((s) => s.id);
    const second = service.query({ limit: 2, offset: 2 }).items.map((s) => s.id);
    expect(second.length).toBe(1);
    expect(first.includes(second[0]!)).toBe(false);
  });

  it("filters by status", async () => {
    const { service, b } = await seeded();
    const ended = service.query({ status: "ended" });
    expect(ended.total).toBe(1);
    expect(ended.items[0]!.id).toBe(b.id);
    expect(service.query({ status: "live" }).total).toBe(2);
  });

  it("searches the transcript, not just the id", async () => {
    const { service, a } = await seeded();
    const hit = service.query({ q: "brackets" });
    expect(hit.total).toBe(1);
    expect(hit.items[0]!.id).toBe(a.id);
    expect(service.query({ q: "TITANIUM" }).total).toBe(1);
    expect(service.query({ q: "nothing said like this" }).total).toBe(0);
  });

  it("bounds the window by start time", async () => {
    const { service, c } = await seeded();
    const all = service.query({ limit: 50 }).items;
    const cutoff = all.find((s) => s.id === c.id)!.createdAt;
    expect(service.query({ from: cutoff }).total).toBe(1);
    expect(service.query({ to: cutoff }).total).toBe(3);
  });

  it("sorts ascending when asked", async () => {
    const { service } = await seeded();
    const asc = service.query({ sort: "started", order: "asc", limit: 50 }).items;
    expect(asc[0]!.createdAt <= asc[asc.length - 1]!.createdAt).toBe(true);
  });

  it("caps a greedy limit rather than returning the whole store", async () => {
    const { service } = await seeded();
    expect(service.query({ limit: 100_000 }).items.length).toBe(3);
  });
});

describe("session export", () => {
  it("carries every brief version, the whole transcript and the sources", async () => {
    const { service } = harness();
    const s = service.create({ prospect: "acme" });
    service.append(s.id, [{ speaker: "caller", text: "we print stainless steel brackets every week" }]);
    await flush();
    const record = service.exportSession(s.id);
    expect(record.briefHistory.length).toBe(1);
    expect(record.transcript.length).toBe(1);
    expect(record.citations.length).toBe(1);
    expect(record.durationSec >= 0).toBe(true);
    // The export is a record, not a live view: throttle bookkeeping stays server-side.
    expect(JSON.stringify(record)).not.toContain("lastFireAt");
  });

  it("refuses an unknown session the same way the rest of the API does", () => {
    const { service } = harness();
    let threw = false;
    try {
      service.exportSession("nope");
    } catch (err) {
      threw = err instanceof ListenSessionNotFound;
    }
    expect(threw).toBe(true);
  });
});

describe("export as a handover note", () => {
  it("renders the brief, its sources, how it evolved and the transcript", async () => {
    const { service, setBrief } = harness();
    setBrief(async () => ({
      brief: {
        topic: "Metal binder jetting",
        summary: "They machine manifolds today and want to print them.",
        caller_profile: "Operations lead",
        their_goal: "Understand the post-print steps",
        key_points: ["Sintering is a separate furnace", ""],
        suggested_questions: ["What volumes per month?"],
        suggested_answers: ["The Shop System suits mid-volume metal parts."],
        recommended_products: ["PureSinter Furnace"],
      },
      citations: [{ title: "Desktop Metal Shop System", url: "https://example.test/shop", score: 0.9 }],
      latency_ms: { retrieve: 10, first_token: 20, total: 30 },
    }));
    const s = service.create({ prospect: "acme" });
    service.append(s.id, [{ speaker: "caller", text: "we machine manifolds and want to print them" }]);
    await flush();
    const md = exportMarkdown(service.exportSession(s.id), "Acme");
    expect(md).toContain("# Conversation");
    expect(md).toContain("**Metal binder jetting**");
    expect(md).toContain("## Key points");
    expect(md).toContain("- Sintering is a separate furnace");
    expect(md).toContain("## Sources");
    expect(md).toContain("https://example.test/shop");
    expect(md).toContain("## How the brief evolved");
    expect(md).toContain("- v1 at");
    expect(md).toContain("**caller:** we machine manifolds");
  });

  it("omits sections the brief never filled rather than printing empty headings", () => {
    const { service } = harness();
    const s = service.create({ prospect: "acme" });
    const md = exportMarkdown(service.exportSession(s.id), "Acme");
    expect(md).toContain("# Conversation");
    expect(md).not.toContain("## Key points");
    expect(md).not.toContain("## Sources");
    expect(md).toContain("Status: live");
  });
});
