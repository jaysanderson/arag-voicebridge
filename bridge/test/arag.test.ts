import { describe, it, expect } from "./_expect.ts";
import { interpretLine, askUrl } from "../src/arag.ts";

describe("askUrl", () => {
  it("builds the regional /ask URL", () => {
    expect(askUrl("europe-1", "kb123")).toBe(
      "https://europe-1.rag.progress.cloud/api/v1/kb/kb123/ask",
    );
  });
});

describe("interpretLine (tolerant NDJSON parsing)", () => {
  it("extracts an answer chunk from {type:answer,text}", () => {
    expect(interpretLine({ type: "answer", text: "Hello " }).answerChunk).toBe("Hello ");
  });

  it("extracts an answer chunk from a bare {answer}", () => {
    expect(interpretLine({ answer: "world" }).answerChunk).toBe("world");
  });

  it("unwraps {item:{...}} envelopes", () => {
    expect(interpretLine({ item: { type: "answer", text: "hi" } }).answerChunk).toBe("hi");
  });

  it("extracts retrieval items from a results array", () => {
    const out = interpretLine({
      type: "retrieval",
      results: [{ title: "Doc A", url: "https://a", score: 0.8 }],
    });
    expect(out.retrieval).toHaveLength(1);
    expect(out.retrieval[0]).toMatchObject({ title: "Doc A", url: "https://a", score: 0.8 });
  });

  it("extracts retrieval items from a nested resources map", () => {
    const out = interpretLine({
      resources: { id1: { title: "Doc B", uri: "https://b", rank_score: 0.5 } },
    });
    expect(out.retrieval[0]).toMatchObject({ title: "Doc B", url: "https://b", score: 0.5 });
  });

  it("ignores non-objects and empty lines gracefully", () => {
    expect(interpretLine(null).retrieval).toEqual([]);
    expect(interpretLine(42).retrieval).toEqual([]);
  });
});
