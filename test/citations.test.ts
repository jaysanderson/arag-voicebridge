import { citationsFrom, extractCitations, retrievalItems } from "../src/services/citations.ts";
import { describe, expect, it } from "./_expect.ts";

describe("extractCitations", () => {
  it("maps retrieval items to {title,url,score} and sorts by score desc", () => {
    const out = extractCitations([
      { title: "Low", url: "https://a", score: 0.2 },
      { title: "High", url: "https://b", score: 0.9 },
    ]);
    expect(out.map((c) => c.title)).toEqual(["High", "Low"]);
  });

  it("skips items without a title", () => {
    const out = extractCitations([
      { url: "https://x", score: 1 },
      { title: "Keep", url: "" },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]!.title).toBe("Keep");
  });

  it("dedupes by title+url, keeping the higher score", () => {
    const out = extractCitations([
      { title: "Same", url: "https://a", score: 0.3 },
      { title: "Same", url: "https://a", score: 0.7 },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]!.score).toBe(0.7);
  });

  it("caps at 4 citations", () => {
    const items = Array.from({ length: 8 }, (_, i) => ({
      title: `T${i}`,
      url: `https://u/${i}`,
      score: i / 10,
    }));
    expect(extractCitations(items)).toHaveLength(4);
  });

  it("coerces bad scores to 0", () => {
    const out = extractCitations([{ title: "X", url: "https://x", score: undefined }]);
    expect(out[0]!.score).toBe(0);
  });
});

describe("retrievalItems (ARAG retrieval results → citation candidates)", () => {
  const retrieval = {
    resources: {
      r1: {
        id: "r1",
        title: "Desktop Metal PureSinter furnace",
        origin: { url: "https://example.test/puresinter" },
        fields: { "/t/text": { paragraphs: { p1: { score: 0.42 }, p2: { score: 0.31 } } } },
      },
      r2: {
        id: "r2",
        title: "Binder jetting explained",
        fields: { "/t/text": { paragraphs: { p1: { score: 0.9 } } } },
      },
      r3: { id: "r3" },
    },
  };

  it("flattens resources, takes the best paragraph score and sorts by score", () => {
    const items = retrievalItems(retrieval);
    expect(items).toHaveLength(2);
    expect(items[0]!).toMatchObject({ title: "Binder jetting explained", score: 0.9 });
    expect(items[1]!).toMatchObject({ title: "Desktop Metal PureSinter furnace", score: 0.42 });
  });

  it("reads the source URL from origin", () => {
    expect(retrievalItems(retrieval)[1]!.url).toBe("https://example.test/puresinter");
  });

  it("skips resources with neither title nor url", () => {
    expect(retrievalItems(retrieval).some((i) => i.title === undefined)).toBe(false);
  });

  it("handles missing/empty retrieval safely", () => {
    expect(retrievalItems(undefined)).toEqual([]);
    expect(retrievalItems({})).toEqual([]);
    expect(citationsFrom(undefined)).toEqual([]);
  });

  it("citationsFrom produces UI citations end to end", () => {
    const cites = citationsFrom(retrieval);
    expect(cites[0]!.title).toBe("Binder jetting explained");
    expect(cites).toHaveLength(2);
  });
});
